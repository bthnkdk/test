using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;
using System.Xml;
using Microsoft.Extensions.Caching.Memory;
using Microsoft.Extensions.Logging;

namespace VK.Emar.Services.Workflow.Api
{
    public interface IApprovalTimelineService
    {
        ApprovalTimelineDto Build(
            string xmlContent,
            long processDefinitionKey,
            string bpmnProcessId,
            IReadOnlyCollection<ElementStateDto> elements,
            IReadOnlyCollection<ProcessMessageSubscription> subscriptions);
    }

    // Repository bağımlılığı yok: veriyi ZeebeApplicationService toplar, bu sınıf sadece hesaplar.
    // Böylece birim testi kolay ve onaycı koduna dokunulmaz.
    public class ApprovalTimelineService : IApprovalTimelineService
    {
        private const string IntentCreated = "CREATED";
        private const string IntentCorrelated = "CORRELATED";
        private const string IntentDeleted = "DELETED";

        private const string VarDecision = "approvalDecision";
        private const string VarUserId = "approverUserId";
        private const string VarReason = "approvalReason";

        // Element durumu bunlardan biriyse süreç şu an o noktada demektir
        private static readonly HashSet<string> ActiveStates =
            new(StringComparer.OrdinalIgnoreCase) { "Active", "Activating", "Completing", "Incident" };

        private static readonly TimeSpan GraphCacheSlidingExpiration = TimeSpan.FromHours(12);

        private readonly IMemoryCache _cache;
        private readonly IApproverNameResolver _nameResolver;
        private readonly ILogger<ApprovalTimelineService> _logger;

        public ApprovalTimelineService(
            IMemoryCache cache,
            IApproverNameResolver nameResolver,
            ILogger<ApprovalTimelineService> logger)
        {
            _cache = cache;
            _nameResolver = nameResolver;
            _logger = logger;
        }

        public ApprovalTimelineDto Build(
            string xmlContent,
            long processDefinitionKey,
            string bpmnProcessId,
            IReadOnlyCollection<ElementStateDto> elements,
            IReadOnlyCollection<ProcessMessageSubscription> subscriptions)
        {
            var result = new ApprovalTimelineDto();

            var graph = GetGraph(xmlContent, processDefinitionKey, bpmnProcessId);
            if (graph == null) return result; // onay verisi alınamasa da geçmiş ekranı açılmaya devam etmeli

            var approvalSubscriptions = (subscriptions ?? Array.Empty<ProcessMessageSubscription>())
                .Where(s => graph.TryGetApproval(s.ElementId, out _))
                .ToList();

            result.History = approvalSubscriptions
                .Where(s => IsIntent(s, IntentCorrelated))
                .OrderBy(s => s.Timestamp)
                .Select(s => ToHistoryItem(graph, s))
                .Where(item => item != null)
                .ToList();

            result.Pending = approvalSubscriptions
                .Where(s => s.ElementInstanceKey.HasValue)
                .GroupBy(s => s.ElementInstanceKey.Value)
                .Where(g => g.Any(s => IsIntent(s, IntentCreated))
                    && !g.Any(s => IsIntent(s, IntentCorrelated) || IsIntent(s, IntentDeleted)))
                .Select(g => g.Where(s => IsIntent(s, IntentCreated)).OrderBy(s => s.Timestamp).First())
                .OrderBy(s => s.Timestamp)
                .Select(s =>
                {
                    graph.TryGetApproval(s.ElementId, out var node);
                    return new ApprovalPendingItemDto
                    {
                        ElementId = s.ElementId,
                        StepName = node.Approval.StepName,
                        GroupName = node.Approval.ApproverLabel,
                        WaitingSince = ToUtc(s.Timestamp),
                    };
                })
                .ToList();

            var activeElementIds = (elements ?? Array.Empty<ElementStateDto>())
                .Where(e => !string.Equals(e.BpmnElementType, "PROCESS", StringComparison.OrdinalIgnoreCase)
                    && e.State != null && ActiveStates.Contains(e.State))
                .Select(e => e.ElementId)
                .Where(id => id != null)
                .Distinct()
                .ToList();

            result.Upcoming = ApprovalPathResolver.Resolve(graph, activeElementIds);

            return result;
        }

        private BpmnProcessGraph GetGraph(string xmlContent, long processDefinitionKey, string bpmnProcessId)
        {
            if (string.IsNullOrWhiteSpace(xmlContent)) return null;

            var cacheKey = $"approval-bpmn-graph:{processDefinitionKey}";
            if (_cache.TryGetValue(cacheKey, out BpmnProcessGraph cached)) return cached;

            try
            {
                var graph = BpmnProcessGraph.Parse(xmlContent, bpmnProcessId, _logger);
                _cache.Set(cacheKey, graph, new MemoryCacheEntryOptions
                {
                    SlidingExpiration = GraphCacheSlidingExpiration,
                    Size = 1, // cache'te SizeLimit tanımlıysa zorunlu, değilse yok sayılır
                });
                return graph;
            }
            catch (XmlException ex)
            {
                _logger.LogError(ex,
                    "Approval timeline: BPMN XML could not be parsed. ProcessDefinitionKey={ProcessDefinitionKey}",
                    processDefinitionKey);
                return null;
            }
        }

        private ApprovalHistoryItemDto ToHistoryItem(BpmnProcessGraph graph, ProcessMessageSubscription s)
        {
            graph.TryGetApproval(s.ElementId, out var node);

            var variables = ReadVariables(s);
            var rawDecision = Get(variables, VarDecision)?.Trim();
            var decision = rawDecision?.ToLowerInvariant() switch
            {
                "approved" => ApprovalDecisions.Approved,
                "rejected" => ApprovalDecisions.Rejected,
                _ => null,
            };

            if (decision == null)
            {
                // Bilinmeyen karar "Onaylandı" gibi yanlış etiketlenmesin diye listeye alınmıyor
                _logger.LogWarning(
                    "Approval timeline: unknown approvalDecision '{Decision}'. ElementId={ElementId}, Key={Key}",
                    rawDecision, s.ElementId, s.Key);
                return null;
            }

            var reason = Get(variables, VarReason);

            return new ApprovalHistoryItemDto
            {
                ElementId = s.ElementId,
                StepName = node.Approval.StepName,
                GroupName = node.Approval.ApproverLabel,
                Decision = decision,
                UserName = _nameResolver.Resolve(Get(variables, VarUserId), node.Approval),
                Reason = string.IsNullOrWhiteSpace(reason) ? null : reason.Trim(),
                Timestamp = ToUtc(s.Timestamp),
            };
        }

        private Dictionary<string, string> ReadVariables(ProcessMessageSubscription s)
        {
            var result = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
            if (string.IsNullOrWhiteSpace(s.Variables)) return result;

            try
            {
                using var doc = JsonDocument.Parse(s.Variables);
                if (doc.RootElement.ValueKind != JsonValueKind.Object) return result;

                foreach (var property in doc.RootElement.EnumerateObject())
                {
                    result[property.Name] = property.Value.ValueKind switch
                    {
                        JsonValueKind.String => property.Value.GetString(),
                        JsonValueKind.Null => null,
                        _ => property.Value.GetRawText(),
                    };
                }
            }
            catch (JsonException ex)
            {
                _logger.LogWarning(ex,
                    "Approval timeline: message variables are not valid JSON. ElementId={ElementId}, Key={Key}",
                    s.ElementId, s.Key);
            }
            return result;
        }

        private static string Get(IReadOnlyDictionary<string, string> values, string key) =>
            values.TryGetValue(key, out var value) ? value : null;

        private static bool IsIntent(ProcessMessageSubscription s, string intent) =>
            string.Equals(s.Intent, intent, StringComparison.OrdinalIgnoreCase);

        private static DateTime ToUtc(long epochMilliseconds) =>
            DateTimeOffset.FromUnixTimeMilliseconds(epochMilliseconds).UtcDateTime;
    }
}
