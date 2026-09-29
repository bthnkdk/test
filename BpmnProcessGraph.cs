using System;
using System.Collections.Generic;
using System.Linq;
using System.Xml.Linq;
using Microsoft.Extensions.Logging;

namespace VK.Emar.Services.Workflow.Api
{
    public sealed class BpmnFlow
    {
        public string Id { get; init; }
        public string TargetId { get; init; }
        public string Name { get; init; }
        public string ConditionExpression { get; init; }
    }

    public sealed class BpmnNode
    {
        public string Id { get; init; }
        public string Type { get; init; } // XML local name: intermediateCatchEvent, exclusiveGateway, subProcess ...
        public string Name { get; init; }
        public string ParentId { get; init; } // içinde bulunduğu subProcess, üst seviyede null
        public string DefaultFlowId { get; init; } // gateway'in default akışı
        public bool IsEventSubProcess { get; init; }
        public ApprovalStepDefinition Approval { get; init; } // onay adımı değilse null
        public List<BpmnFlow> Outgoing { get; } = new();
        public string InnerStartId { get; set; } // subProcess ise içindeki start event

        public bool IsGateway => Type.EndsWith("Gateway", StringComparison.Ordinal);
        public bool IsParallelGateway => Type == "parallelGateway";
        public bool IsContainer => Type is "subProcess" or "transaction" or "adHocSubProcess";
    }

    // Deploy edilmiş XML'den çıkarılan hafif graf. Deploy edilen XML değişmediği için
    // processDefinitionKey bazında cache'lenir (ApprovalTimelineService).
    public sealed class BpmnProcessGraph
    {
        private static readonly XNamespace Bpmn = "http://www.omg.org/spec/BPMN/20100524/MODEL";
        private static readonly XNamespace Zeebe = "http://camunda.org/schema/zeebe/1.0";

        private static readonly HashSet<string> FlowNodeTypes = new(StringComparer.Ordinal)
        {
            "startEvent", "endEvent", "intermediateCatchEvent", "intermediateThrowEvent", "boundaryEvent",
            "task", "serviceTask", "userTask", "sendTask", "receiveTask", "scriptTask", "businessRuleTask",
            "manualTask", "callActivity", "subProcess", "transaction", "adHocSubProcess",
            "exclusiveGateway", "inclusiveGateway", "parallelGateway", "eventBasedGateway", "complexGateway",
        };

        public IReadOnlyDictionary<string, BpmnNode> Nodes { get; }

        private BpmnProcessGraph(IReadOnlyDictionary<string, BpmnNode> nodes) => Nodes = nodes;

        public bool TryGetApproval(string elementId, out BpmnNode node)
        {
            node = null;
            return elementId != null
                && Nodes.TryGetValue(elementId, out node)
                && node.Approval != null;
        }

        public static BpmnProcessGraph Parse(string xml, string bpmnProcessId, ILogger logger)
        {
            var doc = XDocument.Parse(xml);
            var processes = doc.Descendants(Bpmn + "process").ToList();
            var process = processes.FirstOrDefault(p => (string)p.Attribute("id") == bpmnProcessId)
                ?? processes.FirstOrDefault();

            var nodes = new Dictionary<string, BpmnNode>(StringComparer.Ordinal);
            var flows = new List<(string SourceId, BpmnFlow Flow)>();

            if (process != null)
            {
                ParseScope(process, null, nodes, flows, logger);
            }

            foreach (var (sourceId, flow) in flows)
            {
                if (nodes.TryGetValue(sourceId, out var source) && nodes.ContainsKey(flow.TargetId))
                {
                    source.Outgoing.Add(flow);
                }
            }

            foreach (var container in nodes.Values.Where(n => n.IsContainer && !n.IsEventSubProcess))
            {
                container.InnerStartId = nodes.Values
                    .FirstOrDefault(n => n.ParentId == container.Id && n.Type == "startEvent")?.Id;
            }

            return new BpmnProcessGraph(nodes);
        }

        private static void ParseScope(
            XElement scope,
            string parentId,
            Dictionary<string, BpmnNode> nodes,
            List<(string, BpmnFlow)> flows,
            ILogger logger)
        {
            foreach (var el in scope.Elements())
            {
                if (el.Name.Namespace != Bpmn) continue;

                var type = el.Name.LocalName;
                var id = (string)el.Attribute("id");
                if (string.IsNullOrEmpty(id)) continue;

                if (type == "sequenceFlow")
                {
                    flows.Add(((string)el.Attribute("sourceRef"), new BpmnFlow
                    {
                        Id = id,
                        TargetId = (string)el.Attribute("targetRef"),
                        Name = (string)el.Attribute("name"),
                        ConditionExpression = el.Element(Bpmn + "conditionExpression")?.Value,
                    }));
                    continue;
                }

                if (!FlowNodeTypes.Contains(type)) continue;

                var name = (string)el.Attribute("name");
                var properties = ReadProperties(el);
                var node = new BpmnNode
                {
                    Id = id,
                    Type = type,
                    Name = name,
                    ParentId = parentId,
                    DefaultFlowId = (string)el.Attribute("default"),
                    IsEventSubProcess = (string)el.Attribute("triggeredByEvent") == "true",
                    Approval = ApprovalStepDefinition.TryCreate(id, name, properties, logger),
                };
                nodes[id] = node;

                if (node.IsContainer)
                {
                    ParseScope(el, id, nodes, flows, logger);
                }
            }
        }

        private static Dictionary<string, string> ReadProperties(XElement el)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var properties = el.Element(Bpmn + "extensionElements")
                ?.Element(Zeebe + "properties")
                ?.Elements(Zeebe + "property");

            if (properties == null) return result;

            foreach (var property in properties)
            {
                var key = (string)property.Attribute("name");
                if (!string.IsNullOrWhiteSpace(key))
                {
                    result[key] = (string)property.Attribute("value");
                }
            }
            return result;
        }
    }

    // approval-routing properties panelinin yazdığı zeebe:properties değerleri
    public sealed class ApprovalStepDefinition
    {
        private static readonly string[] ApproverKeys =
        {
            "approvalWorkgroupIds", "approvalWorkgroupNames",
            "approvalRoleIds", "approvalRoleNames",
            "approvalEmployeeIds", "approvalEmployeeNames", "approvalEmployeeNumbers",
        };

        public string StepName { get; init; }
        public string ApproverLabel { get; init; }
        public IReadOnlyDictionary<string, string> EmployeeNamesByNumber { get; init; }

        public static ApprovalStepDefinition TryCreate(
            string elementId,
            string elementName,
            IReadOnlyDictionary<string, string> props,
            ILogger logger)
        {
            if (!ApproverKeys.Any(key => !string.IsNullOrWhiteSpace(Get(props, key))))
            {
                return null; // onay adımı değil
            }

            var names = new List<string>();
            names.AddRange(ReadNames(props, "approvalWorkgroupIds", "approvalWorkgroupNames", elementId, logger));
            names.AddRange(ReadNames(props, "approvalRoleIds", "approvalRoleNames", elementId, logger));
            names.AddRange(ReadNames(props, "approvalEmployeeIds", "approvalEmployeeNames", elementId, logger));

            var joiner = string.Equals(Get(props, "approvalLogic")?.Trim(), "AND", StringComparison.OrdinalIgnoreCase)
                ? " ve "
                : " veya ";

            return new ApprovalStepDefinition
            {
                StepName = FirstNonBlank(elementName, Get(props, "approvalScreenName"), elementId),
                ApproverLabel = names.Count > 0 ? string.Join(joiner, names) : "-",
                EmployeeNamesByNumber = ReadEmployeeMap(props, elementId, logger),
            };
        }

        // İsimler id'lerle aynı sırada virgülle tutuluyor. Adın kendisi virgül içerirse sayılar tutmaz:
        // o durumda bölmeden ham değeri gösterip logluyoruz (ayırıcı değişene kadar geçici önlem).
        private static IEnumerable<string> ReadNames(
            IReadOnlyDictionary<string, string> props, string idsKey, string namesKey, string elementId, ILogger logger)
        {
            var raw = Get(props, namesKey);
            if (string.IsNullOrWhiteSpace(raw)) return Array.Empty<string>();

            var names = Split(raw);
            var ids = Split(Get(props, idsKey));
            if (ids.Count > 0 && ids.Count != names.Count)
            {
                logger.LogWarning(
                    "Approval property count mismatch on {ElementId}: {IdsKey}={IdCount}, {NamesKey}={NameCount}. Raw value shown unsplit.",
                    elementId, idsKey, ids.Count, namesKey, names.Count);
                return new[] { raw.Trim() };
            }
            return names;
        }

        private static IReadOnlyDictionary<string, string> ReadEmployeeMap(
            IReadOnlyDictionary<string, string> props, string elementId, ILogger logger)
        {
            var map = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            var numbers = Split(Get(props, "approvalEmployeeNumbers"));
            var names = Split(Get(props, "approvalEmployeeNames"));

            if (numbers.Count == 0) return map;
            if (numbers.Count != names.Count)
            {
                logger.LogWarning(
                    "Approval employee number/name count mismatch on {ElementId}: {NumberCount} numbers, {NameCount} names.",
                    elementId, numbers.Count, names.Count);
                return map;
            }

            for (var i = 0; i < numbers.Count; i++)
            {
                map[numbers[i]] = names[i];
            }
            return map;
        }

        private static List<string> Split(string value) =>
            string.IsNullOrWhiteSpace(value)
                ? new List<string>()
                : value.Split(',').Select(v => v.Trim()).Where(v => v.Length > 0).ToList();

        private static string Get(IReadOnlyDictionary<string, string> props, string key) =>
            props.TryGetValue(key, out var value) ? value : null;

        private static string FirstNonBlank(params string[] values) =>
            values.FirstOrDefault(v => !string.IsNullOrWhiteSpace(v))?.Trim();
    }
}
