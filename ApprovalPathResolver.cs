using System;
using System.Collections.Generic;
using System.Linq;

namespace VK.Emar.Services.Workflow.Api
{
    // Aktif elementlerden ileriye doğru BFS (genişlik öncelikli arama) ile sıradaki onay adımlarını bulur.
    public static class ApprovalPathResolver
    {
        private const int MaxLabelLength = 60;

        public static List<ApprovalUpcomingItemDto> Resolve(BpmnProcessGraph graph, IEnumerable<string> activeElementIds)
        {
            var startIds = activeElementIds.Where(graph.Nodes.ContainsKey).Distinct().ToList();
            var visited = new HashSet<string>(startIds, StringComparer.Ordinal);
            var queue = new Queue<string>();
            var traversal = new List<BpmnNode>(); // ziyaret sırası = akış sırası

            // Başlangıç: aktif elementler. Aktif bir subProcess'in içine tekrar girilmez (zaten içindeyiz),
            // sadece çıkışlarından devam edilir.
            foreach (var startId in startIds)
            {
                var start = graph.Nodes[startId];
                traversal.Add(start);
                foreach (var next in Successors(graph, start, enterContainer: false))
                {
                    if (visited.Add(next)) queue.Enqueue(next);
                }
            }

            while (queue.Count > 0)
            {
                var node = graph.Nodes[queue.Dequeue()];
                traversal.Add(node);
                foreach (var next in Successors(graph, node, enterContainer: true))
                {
                    if (visited.Add(next)) queue.Enqueue(next);
                }
            }

            var upcoming = traversal
                .Where(n => n.Approval != null && !startIds.Contains(n.Id))
                .ToList();

            if (upcoming.Count == 0) return new List<ApprovalUpcomingItemDto>();

            var labels = upcoming.ToDictionary(n => n.Id, _ => new List<string>());
            var parallel = new HashSet<string>(StringComparer.Ordinal);

            foreach (var gateway in traversal.Where(n => n.IsGateway && n.Outgoing.Count > 1))
            {
                MarkBranches(graph, gateway, upcoming, labels, parallel);
            }

            return upcoming.Select(n => new ApprovalUpcomingItemDto
            {
                ElementId = n.Id,
                StepName = n.Approval.StepName,
                GroupName = n.Approval.ApproverLabel,
                ConditionLabel = labels[n.Id].Count > 0 ? string.Join(" · ", labels[n.Id]) : null,
                Parallel = parallel.Contains(n.Id),
            }).ToList();
        }

        // Dallanan bir gateway'in dallarını inceler:
        //  - Çıkış dalı: onay içermeyen ve diğer dallarla hiç birleşmeyen dal (red/iptal → bitiş). Koşul sayılmaz.
        //  - Anlamlı dal sayısı 2+ ise: sadece TEK bir anlamlı daldan ulaşılan onaylar koşullu/paralel işaretlenir.
        //    Birden fazla daldan ulaşılan onaylar (birleşme sonrası) her durumda gelecektir, işaretlenmez.
        private static void MarkBranches(
            BpmnProcessGraph graph,
            BpmnNode gateway,
            List<BpmnNode> upcoming,
            Dictionary<string, List<string>> labels,
            HashSet<string> parallel)
        {
            var branches = gateway.Outgoing
                .Select(flow =>
                {
                    var reach = Reach(graph, flow.TargetId, gateway.Id);
                    // Aynı bitiş event'ine varmak birleşme değildir (örn. iki red dalı tek bitişe gider)
                    var reachWithoutEnds = new HashSet<string>(
                        reach.Where(id => graph.Nodes[id].Type != "endEvent"), StringComparer.Ordinal);
                    return (Flow: flow, Reach: reach, ReachWithoutEnds: reachWithoutEnds);
                })
                .ToList();

            var meaningful = branches.Where(branch =>
            {
                var hasApproval = branch.Reach.Any(id => graph.Nodes[id].Approval != null);
                var rejoins = branches.Any(other =>
                    !ReferenceEquals(other.Flow, branch.Flow)
                    && other.ReachWithoutEnds.Overlaps(branch.ReachWithoutEnds));
                return hasApproval || rejoins;
            }).ToList();

            if (meaningful.Count < 2) return;

            foreach (var approval in upcoming)
            {
                var containing = meaningful.Where(b => b.Reach.Contains(approval.Id)).ToList();
                if (containing.Count != 1) continue;

                if (gateway.IsParallelGateway)
                {
                    parallel.Add(approval.Id);
                }
                else
                {
                    labels[approval.Id].Add(BranchLabel(graph, gateway, containing[0].Flow));
                }
            }
        }

        private static HashSet<string> Reach(BpmnProcessGraph graph, string fromId, string excludeId)
        {
            var reach = new HashSet<string>(StringComparer.Ordinal);
            if (fromId == excludeId) return reach;

            var queue = new Queue<string>();
            reach.Add(fromId);
            queue.Enqueue(fromId);

            while (queue.Count > 0)
            {
                foreach (var next in Successors(graph, graph.Nodes[queue.Dequeue()], enterContainer: true))
                {
                    if (next != excludeId && reach.Add(next)) queue.Enqueue(next);
                }
            }
            return reach;
        }

        private static IEnumerable<string> Successors(BpmnProcessGraph graph, BpmnNode node, bool enterContainer)
        {
            // SubProcess'e girerken içindeki start event'ten devam et; çıkışlarına iç akış bitince ulaşılır.
            if (enterContainer && node.IsContainer && node.InnerStartId != null)
            {
                return new[] { node.InnerStartId };
            }

            if (node.Outgoing.Count > 0)
            {
                return node.Outgoing.Select(f => f.TargetId);
            }

            // SubProcess içindeki bitiş: subProcess'in çıkışlarından devam et.
            if (node.ParentId != null && graph.Nodes.TryGetValue(node.ParentId, out var parent))
            {
                return parent.Outgoing.Select(f => f.TargetId);
            }

            return Array.Empty<string>();
        }

        private static string BranchLabel(BpmnProcessGraph graph, BpmnNode gateway, BpmnFlow flow)
        {
            string label;
            if (!string.IsNullOrWhiteSpace(flow.Name))
            {
                label = flow.Name.Trim();
            }
            else if (flow.Id == gateway.DefaultFlowId)
            {
                label = "Varsayılan dal";
            }
            else if (!string.IsNullOrWhiteSpace(flow.ConditionExpression))
            {
                label = flow.ConditionExpression.Trim().TrimStart('=').Trim();
            }
            else
            {
                label = graph.Nodes.TryGetValue(flow.TargetId, out var target) && !string.IsNullOrWhiteSpace(target.Name)
                    ? target.Name.Trim()
                    : flow.Id;
            }

            return label.Length > MaxLabelLength ? label[..(MaxLabelLength - 1)] + "…" : label;
        }
    }
}
