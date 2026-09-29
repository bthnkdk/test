namespace VK.Emar.Services.Workflow.Api
{
    // Sicil numarasını (approverUserId) görünen ada çevirir.
    // İleride kullanıcı/İK servisi bağlanırsa sadece bu implementasyon değişir.
    public interface IApproverNameResolver
    {
        string Resolve(string approverUserId, ApprovalStepDefinition step);
    }

    // Şimdilik: onay adımında kişi olarak tanımlıysa adı XML'deki approvalEmployeeNumbers/Names eşlemesinden bulur,
    // değilse (grup/rol üzerinden onaylayanlar) sicili olduğu gibi döner.
    public class StepDefinitionApproverNameResolver : IApproverNameResolver
    {
        public string Resolve(string approverUserId, ApprovalStepDefinition step)
        {
            if (string.IsNullOrWhiteSpace(approverUserId)) return "-";

            var userId = approverUserId.Trim();
            return step?.EmployeeNamesByNumber != null
                && step.EmployeeNamesByNumber.TryGetValue(userId, out var name)
                && !string.IsNullOrWhiteSpace(name)
                ? $"{name} ({userId})"
                : userId;
        }
    }
}
