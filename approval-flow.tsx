import type { ReactNode } from 'react';
import type {
  ApprovalTimeline,
  ApprovalHistoryItem,
  ApprovalPendingItem,
  ApprovalUpcomingItem,
} from './types.ts';
import styles from './BPMNProcessHistory.module.css';

// Not: Bu dosyadaki yardımcıların adları create.tsx'tekilerle çakışmayacak şekilde seçildi,
// ileride bileşen create.tsx içine taşınırsa kes-yapıştır yeterli olsun diye.

const formatApprovalDate = (date?: string) => {
  if (!date) return '-';
  return date.replace('T', ' ').replace('Z', '').split('.')[0].slice(0, 16);
};

const formatWaiting = (since: string) => {
  const diffMs = Date.now() - new Date(since).getTime();
  if (Number.isNaN(diffMs) || diffMs < 0) return '-';

  const minutes = Math.floor(diffMs / 60000);
  const days = Math.floor(minutes / 1440);
  const hours = Math.floor((minutes % 1440) / 60);

  if (days > 0) return hours > 0 ? `${days} gün ${hours} sa` : `${days} gün`;
  if (hours > 0) return `${hours} sa ${minutes % 60} dk`;
  return `${Math.max(minutes, 1)} dk`;
};

const joinApprovalClasses = (...classes: (string | false | undefined)[]) =>
  classes.filter(Boolean).join(' ');

interface ApprovalFlowProps {
  timeline: ApprovalTimeline;
  selectedElementId?: string | null;
  onStepClick: (elementId: string) => void;
}

const ApprovalSection = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className={styles.approvalSection}>
    <h4 className={styles.approvalSectionTitle}>{title}</h4>
    {children}
  </section>
);

const ApprovalRow = ({
  elementId,
  variant,
  icon,
  title,
  meta,
  extra,
  selected,
  onClick,
}: {
  elementId: string;
  variant: 'approved' | 'rejected' | 'pending' | 'upcoming';
  icon: string;
  title: ReactNode;
  meta: ReactNode;
  extra?: ReactNode;
  selected: boolean;
  onClick: (elementId: string) => void;
}) => (
  <div
    role="button"
    tabIndex={0}
    className={joinApprovalClasses(
      styles.approvalRow,
      variant === 'pending' && styles.approvalRowPending,
      variant === 'upcoming' && styles.approvalRowUpcoming,
      selected && styles.approvalRowSelected
    )}
    onClick={() => onClick(elementId)}
    onKeyDown={(e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onClick(elementId);
      }
    }}
  >
    <span
      className={joinApprovalClasses(
        styles.approvalIcon,
        variant === 'approved' && styles.approvalIconApproved,
        variant === 'rejected' && styles.approvalIconRejected,
        variant === 'pending' && styles.approvalIconPending,
        variant === 'upcoming' && styles.approvalIconUpcoming
      )}
      aria-hidden="true"
    >
      {icon}
    </span>
    <div className={styles.approvalBody}>
      <div className={styles.approvalTitle}>{title}</div>
      <div className={styles.approvalMeta}>{meta}</div>
      {extra}
    </div>
  </div>
);

export const ApprovalFlow = ({ timeline, selectedElementId, onStepClick }: ApprovalFlowProps) => {
  const { history, pending, upcoming } = timeline;
  const isEmpty = history.length === 0 && pending.length === 0 && upcoming.length === 0;

  if (isEmpty) {
    return <div className={styles.approvalEmpty}>Bu süreçte onay adımı yok</div>;
  }

  const isSelected = (elementId: string) => selectedElementId === elementId;

  return (
    <div className={styles.approvalList}>
      {history.length > 0 && (
        <ApprovalSection title="Tamamlanan">
          {history.map((item: ApprovalHistoryItem) => {
            const rejected = item.decision === 'Rejected';
            return (
              <ApprovalRow
                key={`${item.elementId}-${item.timestamp}`}
                elementId={item.elementId}
                variant={rejected ? 'rejected' : 'approved'}
                icon={rejected ? '✕' : '✓'}
                title={
                  <>
                    {item.stepName}
                    <span
                      className={joinApprovalClasses(
                        styles.approvalPill,
                        rejected ? styles.approvalPillRejected : styles.approvalPillApproved
                      )}
                    >
                      {rejected ? 'Reddedildi' : 'Onaylandı'}
                    </span>
                  </>
                }
                meta={
                  <>
                    {item.groupName} · {item.userName} ·{' '}
                    <span className={styles.mono}>{formatApprovalDate(item.timestamp)}</span>
                  </>
                }
                extra={
                  item.reason ? (
                    <div
                      className={joinApprovalClasses(
                        styles.approvalReason,
                        rejected && styles.approvalReasonRejected
                      )}
                    >
                      {rejected ? 'Red sebebi: ' : 'Not: '}
                      {item.reason}
                    </div>
                  ) : undefined
                }
                selected={isSelected(item.elementId)}
                onClick={onStepClick}
              />
            );
          })}
        </ApprovalSection>
      )}

      {pending.length > 0 && (
        <ApprovalSection title="Bekleyen">
          {pending.map((item: ApprovalPendingItem) => (
            <ApprovalRow
              key={item.elementId}
              elementId={item.elementId}
              variant="pending"
              icon="⏱"
              title={item.stepName}
              meta={
                <>
                  {item.groupName} · Bekleme süresi: {formatWaiting(item.waitingSince)} ·
                  Başlangıç:{' '}
                  <span className={styles.mono}>{formatApprovalDate(item.waitingSince)}</span>
                </>
              }
              selected={isSelected(item.elementId)}
              onClick={onStepClick}
            />
          ))}
        </ApprovalSection>
      )}

      {upcoming.length > 0 && (
        <ApprovalSection title="Sıradaki">
          {upcoming.map((item: ApprovalUpcomingItem) => (
            <ApprovalRow
              key={item.elementId}
              elementId={item.elementId}
              variant="upcoming"
              icon="↓"
              title={
                <>
                  {item.stepName}
                  {item.conditionLabel && (
                    <span className={styles.approvalPill}>Koşullu: {item.conditionLabel}</span>
                  )}
                  {item.parallel && <span className={styles.approvalPill}>Paralel</span>}
                </>
              }
              meta={item.groupName}
              selected={isSelected(item.elementId)}
              onClick={onStepClick}
            />
          ))}
        </ApprovalSection>
      )}
    </div>
  );
};
