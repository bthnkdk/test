using System;
using System.Collections.Generic;

namespace VK.Emar.Services.Workflow.Api
{
    // ProcessInstanceDetailDto.ApprovalTimeline içinde döner (frontend: approvalTimeline)
    public class ApprovalTimelineDto
    {
        public List<ApprovalHistoryItemDto> History { get; set; } = new();
        public List<ApprovalPendingItemDto> Pending { get; set; } = new();
        public List<ApprovalUpcomingItemDto> Upcoming { get; set; } = new();
    }

    public class ApprovalHistoryItemDto
    {
        public string ElementId { get; set; }
        public string StepName { get; set; }
        public string GroupName { get; set; }
        public string Decision { get; set; } // ApprovalDecisions.Approved / Rejected
        public string UserName { get; set; }
        public string Reason { get; set; } // boş olabilir
        public DateTime Timestamp { get; set; } // UTC
    }

    public class ApprovalPendingItemDto
    {
        public string ElementId { get; set; }
        public string StepName { get; set; }
        public string GroupName { get; set; }
        public DateTime WaitingSince { get; set; } // UTC
    }

    public class ApprovalUpcomingItemDto
    {
        public string ElementId { get; set; }
        public string StepName { get; set; }
        public string GroupName { get; set; }
        public string ConditionLabel { get; set; } // sadece gerçekten koşula bağlı adımlarda dolu
        public bool Parallel { get; set; }
    }

    // Enum yerine string: frontend 'Approved' | 'Rejected' bekliyor
    public static class ApprovalDecisions
    {
        public const string Approved = "Approved";
        public const string Rejected = "Rejected";
    }
}
