import { useEffect, useRef, useCallback, useState } from 'react';
import type { CSSProperties, ReactNode } from 'react';
import { VKGrid, VKSpinner } from '@vakif/ui';
import { useVKSnackbar } from '@vakif/business';
import { useGetProcessInstanceHistory } from '../../../hooks/index.ts';
import {
  ElementState,
  TimelineEvent,
  JobTimelineEvent,
  IncidentTimeLineEvent,
  VariableTimelineEvent,
  ProcessInstanceDetail,
  SelectableEvent,
  Column,
  Tone,
  BPMNMonitorProps,
  STATE_COLORS,
  INTENT_STYLES,
  INSTANCE_STATE_STYLES,
  VARIABLE_INTENT_TONE,
  DANGER_TONE,
  NEUTRAL_TONE,
  DIAGRAM_HEIGHT,
  SNACK_MESSAGE_TYPES,
} from './types.ts';
import styles from './BPMNProcessHistory.module.css';

import BpmnViewer from 'bpmn-js/lib/NavigatedViewer';
import ElementRegistry from 'diagram-js/lib/core/ElementRegistry';
import type Canvas from 'diagram-js/lib/core/Canvas';
import 'bpmn-js/dist/assets/diagram-js.css';
import 'bpmn-js/dist/assets/bpmn-font/css/bpmn.css';

type TabKey = 'timeline' | 'variables' | 'jobs' | 'incidents';

const formatDate = (date?: string) => {
  if (!date) return '-';
  return date.replace('T', ' ').replace('Z', '').split('.')[0];
};

const prettyJson = (value: string) => {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
};

const isSameEvent = (a: SelectableEvent | null, b: SelectableEvent) =>
  !!a && a.position === b.position && a.partitionId === b.partitionId;

const eventRowKey = (row: SelectableEvent, index: number) =>
  `${row.partitionId ?? '-'}-${row.position}-${index}`;

const cx = (...classes: (string | false | undefined)[]) => classes.filter(Boolean).join(' ');

const Badge = ({
  label,
  tone = NEUTRAL_TONE,
  size = 'sm',
}: {
  label: ReactNode;
  tone?: Tone;
  size?: 'sm' | 'md';
}) => (
  <span
    className={styles.badge}
    style={{
      padding: size === 'md' ? '2px 10px' : '1px 7px',
      fontSize: size === 'md' ? 12 : 11,
      backgroundColor: tone.bg,
      color: tone.color,
    }}
  >
    {label}
  </span>
);

function DataTable<T>({
  columns,
  rows,
  rowKey,
  onRowClick,
  isSelected,
  emptyText,
}: {
  columns: Column<T>[];
  rows: T[] | null | undefined;
  rowKey: (row: T, index: number) => string;
  onRowClick?: (row: T) => void;
  isSelected?: (row: T) => boolean;
  emptyText: string;
}) {
  const data = rows ?? [];

  return (
    <div className={styles.tableScroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                style={column.width !== undefined ? { width: column.width } : undefined}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {data.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={styles.empty}>
                {emptyText}
              </td>
            </tr>
          ) : (
            data.map((row, index) => (
              <tr
                key={rowKey(row, index)}
                className={
                  cx(onRowClick && styles.clickable, isSelected?.(row) && styles.selected) ||
                  undefined
                }
                onClick={onRowClick ? () => onRowClick(row) : undefined}
              >
                {columns.map((column) => (
                  <td key={column.key} className={column.className}>
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

const Field = ({
  label,
  children,
  mono,
  className,
}: {
  label: string;
  children: ReactNode;
  mono?: boolean;
  className?: string;
}) => (
  <div className={cx(styles.field, className)}>
    <span className={styles.fieldLabel}>{label}</span>
    <span className={cx(styles.fieldValue, mono && styles.mono)}>{children}</span>
  </div>
);

const BPMNProcessHistory = ({
  processKey,
  bpmnModelVersionId,
  bpmnProcessId,
}: BPMNMonitorProps) => {
  const [instanceDetail, setInstanceDetail] = useState<ProcessInstanceDetail | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<SelectableEvent | null>(null);
  const [activeTab, setActiveTab] = useState<TabKey>('timeline');
  const [expandedVariable, setExpandedVariable] = useState<string | null>(null);

  const canvasRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<BpmnViewer | null>(null);
  const prevHighlightRef = useRef<string | null>(null);

  const { showSnackbarMessage } = useVKSnackbar();
  const { execute: executeHistory, isLoading } = useGetProcessInstanceHistory(
    'GetInstanceProcessHistory'
  );

  useEffect(() => {
    const fetchData = async () => {
      try {
        const result: any = await executeHistory({
          options: {
            body: {
              processKey,
              bpmnModelVersionId,
              bpmnProcessId,
            },
          },
        }).unwrap();
        setInstanceDetail(result?.data?.data);
      } catch (error: any) {
        const serverMessage = error?.data?.message;
        if (serverMessage) {
          showSnackbarMessage(serverMessage, SNACK_MESSAGE_TYPES.WARNING);
        } else {
          showSnackbarMessage(
            error?.message || 'Bilinmeyen bir hata oluştu',
            SNACK_MESSAGE_TYPES.ERROR
          );
        }
      }
    };
    fetchData();
  }, [processKey, bpmnModelVersionId]);

  const colorizeElements = useCallback((viewer: BpmnViewer, elements: ElementState[]) => {
    const elementRegistry = viewer.get('elementRegistry') as ElementRegistry;
    const latestByElement: Record<string, ElementState> = {};
    elements.forEach((el) => {
      latestByElement[el.elementId] = el;
    });

    Object.values(latestByElement).forEach((el) => {
      const colors = STATE_COLORS[el.state];
      if (!colors) return;

      const gfx = elementRegistry.getGraphics(el.elementId);
      if (!gfx) return;

      if (el.bpmnElementType === 'SEQUENCE_FLOW') {
        const path = gfx.querySelector('.djs-visual path') as SVGElement;
        if (path) {
          path.style.stroke = colors.stroke;
          path.style.strokeWidth = '3px';
        }
      } else {
        const visual = gfx.querySelector(
          '.djs-visual rect, .djs-visual circle, .djs-visual polygon, .djs-visual path'
        ) as SVGElement;
        if (visual) {
          visual.style.stroke = colors.stroke;
          visual.style.strokeWidth = '3px';
          if (colors.fill !== 'none') {
            visual.style.fill = colors.fill;
          }
        }
      }
    });
  }, []);

  const clearHighlight = useCallback(() => {
    const viewer = viewerRef.current;
    if (viewer && prevHighlightRef.current) {
      const canvas = viewer.get('canvas') as Canvas;
      canvas.removeMarker(prevHighlightRef.current, 'highlight');
    }
    prevHighlightRef.current = null;
  }, []);

  const highlightElement = useCallback(
    (elementId?: string) => {
      const viewer = viewerRef.current;
      if (!viewer || !elementId) return;

      const elementRegistry = viewer.get('elementRegistry') as ElementRegistry;
      if (!elementRegistry.get(elementId)) return;

      clearHighlight();
      const canvas = viewer.get('canvas') as Canvas;
      canvas.addMarker(elementId, 'highlight');
      prevHighlightRef.current = elementId;
    },
    [clearHighlight]
  );

  const selectEvent = useCallback(
    (event: SelectableEvent) => {
      setSelectedEvent(event);
      highlightElement(event.elementId);
    },
    [highlightElement]
  );

  const closeDetail = useCallback(() => {
    setSelectedEvent(null);
    clearHighlight();
  }, [clearHighlight]);

  const zoom = useCallback((action: 'in' | 'out' | 'fit') => {
    const viewer = viewerRef.current;
    if (!viewer) return;

    const canvas = viewer.get('canvas') as Canvas;
    if (action === 'fit') {
      canvas.zoom('fit-viewport', 'auto');
      return;
    }
    const current = canvas.zoom();
    canvas.zoom(action === 'in' ? current * 1.2 : current / 1.2, 'auto');
  }, []);

  useEffect(() => {
    if (!canvasRef.current || !instanceDetail) return;

    const viewer = new BpmnViewer({
      container: canvasRef.current,
    });
    viewerRef.current = viewer;

    viewer
      .importXML(instanceDetail.xmlContent)
      .then(() => {
        const canvas = viewer.get('canvas') as Canvas;
        canvas.zoom('fit-viewport');

        if (instanceDetail.elements) {
          colorizeElements(viewer, instanceDetail.elements);
        }
      })
      .catch(console.error);

    return () => {
      viewer.destroy();
      viewerRef.current = null;
      prevHighlightRef.current = null;
    };
  }, [instanceDetail, colorizeElements]);

  if (!instanceDetail) return isLoading ? <VKSpinner /> : null;

  const { instance, timeline, variables, jobs, incidents } = instanceDetail;

  const tabs: { key: TabKey; label: string; count: number; danger?: boolean }[] = [
    { key: 'timeline', label: 'Audit log', count: timeline?.length ?? 0 },
    { key: 'variables', label: 'Variables', count: variables?.length ?? 0 },
    { key: 'jobs', label: 'Jobs', count: jobs?.length ?? 0 },
    { key: 'incidents', label: 'Incidents', count: incidents?.length ?? 0, danger: true },
  ];

  const timelineColumns: Column<TimelineEvent>[] = [
    {
      key: 'time',
      header: 'Time',
      width: 150,
      className: styles.mono,
      render: (e) => formatDate(e.timestamp),
    },
    { key: 'element', header: 'Element', render: (e) => e.elementId },
    { key: 'type', header: 'Type', className: styles.muted, render: (e) => e.bpmnElementType },
    {
      key: 'intent',
      header: 'Intent',
      render: (e) => <Badge label={e.intent} tone={INTENT_STYLES[e.intent]} />,
    },
    { key: 'key', header: 'Key', className: cx(styles.mono, styles.muted), render: (e) => e.key },
    {
      key: 'position',
      header: 'Position',
      className: cx(styles.mono, styles.muted),
      render: (e) => e.position,
    },
  ];

  const variableId = (v: VariableTimelineEvent) => `${v.partitionId}-${v.position}`;

  const variableColumns: Column<VariableTimelineEvent>[] = [
    {
      key: 'time',
      header: 'Time',
      width: 150,
      className: styles.mono,
      render: (v) => formatDate(v.timestamp),
    },
    {
      key: 'intent',
      header: 'Intent',
      render: (v) => <Badge label={v.intent} tone={VARIABLE_INTENT_TONE} />,
    },
    { key: 'name', header: 'Name', className: styles.strong, render: (v) => v.name },
    {
      key: 'value',
      header: 'Value',
      className: cx(styles.mono, styles.valueCell),
      render: (v) =>
        expandedVariable === variableId(v) ? (
          <pre className={styles.pre}>{prettyJson(v.value)}</pre>
        ) : (
          <span className={styles.truncate} title={v.value}>
            {v.value}
          </span>
        ),
    },
    {
      key: 'scopeKey',
      header: 'Scope Key',
      className: cx(styles.mono, styles.muted),
      render: (v) => v.scopeKey,
    },
    { key: 'key', header: 'Key', className: cx(styles.mono, styles.muted), render: (v) => v.key },
  ];

  const jobColumns: Column<JobTimelineEvent>[] = [
    {
      key: 'time',
      header: 'Time',
      width: 150,
      className: styles.mono,
      render: (j) => formatDate(j.timestamp),
    },
    { key: 'element', header: 'Element', render: (j) => j.elementId || '-' },
    {
      key: 'intent',
      header: 'Intent',
      render: (j) => <Badge label={j.intent} tone={INTENT_STYLES[j.intent]} />,
    },
    { key: 'type', header: 'Type', render: (j) => j.type },
    { key: 'worker', header: 'Worker', className: styles.muted, render: (j) => j.worker || '-' },
    { key: 'retries', header: 'Retries', className: styles.mono, render: (j) => j.retries },
    {
      key: 'error',
      header: 'Error',
      className: styles.errorText,
      render: (j) => j.errorMessage || '-',
    },
  ];

  const incidentColumns: Column<IncidentTimeLineEvent>[] = [
    {
      key: 'time',
      header: 'Time',
      width: 150,
      className: styles.mono,
      render: (i) => formatDate(i.timestamp),
    },
    { key: 'element', header: 'Element', render: (i) => i.elementId },
    {
      key: 'errorType',
      header: 'Error Type',
      render: (i) => <Badge label={i.errorType} tone={DANGER_TONE} />,
    },
    {
      key: 'errorMessage',
      header: 'Error Message',
      className: styles.errorText,
      render: (i) => i.errorMessage || '-',
    },
    {
      key: 'jobKey',
      header: 'Job Key',
      className: cx(styles.mono, styles.muted),
      render: (i) => i.jobKey || '-',
    },
    { key: 'state', header: 'State', render: (i) => i.state },
  ];

  const selectableTableProps = {
    rowKey: eventRowKey,
    onRowClick: selectEvent,
    isSelected: (row: SelectableEvent) => isSameEvent(selectedEvent, row),
  };

  return (
    <VKGrid size={12}>
      <div
        className={styles.root}
        style={{ '--diagram-height': `${DIAGRAM_HEIGHT}px` } as CSSProperties}
      >
        <div className={styles.summary}>
          <Field label="Process instance key" mono>
            {instance.processInstanceKey}
          </Field>
          <Field label="State">
            <Badge label={instance.state} tone={INSTANCE_STATE_STYLES[instance.state]} size="md" />
          </Field>
          <Field label="BPMN process">
            {instance.bpmnProcessId} · v{instance.version}
          </Field>
          <Field label="Start time" mono>
            {formatDate(instance.startTime)}
          </Field>
          <Field label="End time" mono>
            {formatDate(instance.endTime)}
          </Field>
          <Field label="Duration">{instance.duration || '-'}</Field>
          <Field label="Tenant" className={styles.pushRight}>
            {instance.tenantId || '-'}
          </Field>
        </div>

        <div className={styles.diagramWrap}>
          <div ref={canvasRef} className={styles.canvas} />

          <div className={styles.toolbar}>
            <button type="button" className={styles.toolButton} onClick={() => zoom('in')} aria-label="Yakınlaştır">
              +
            </button>
            <button type="button" className={styles.toolButton} onClick={() => zoom('out')} aria-label="Uzaklaştır">
              −
            </button>
            <button type="button" className={styles.toolButton} onClick={() => zoom('fit')} aria-label="Sığdır">
              ⤢
            </button>
          </div>

          {selectedEvent && (
            <div className={styles.detail}>
              <div className={styles.detailHeader}>
                <span className={styles.detailTitle} title={selectedEvent.elementId}>
                  {selectedEvent.elementId || '-'}
                </span>
                <button
                  type="button"
                  className={styles.closeButton}
                  onClick={closeDetail}
                  aria-label="Kapat"
                >
                  ×
                </button>
              </div>
              {selectedEvent.intent && (
                <Badge label={selectedEvent.intent} tone={INTENT_STYLES[selectedEvent.intent]} />
              )}
              <dl className={styles.detailGrid}>
                <dt>Type</dt>
                <dd>{selectedEvent.bpmnElementType || selectedEvent.type || '-'}</dd>
                <dt>Timestamp</dt>
                <dd className={styles.mono}>{formatDate(selectedEvent.timestamp)}</dd>
                <dt>Key</dt>
                <dd className={styles.mono}>{selectedEvent.key ?? '-'}</dd>
                <dt>Position</dt>
                <dd className={styles.mono}>{selectedEvent.position}</dd>
                <dt>Partition</dt>
                <dd className={styles.mono}>{selectedEvent.partitionId ?? '-'}</dd>
              </dl>
            </div>
          )}
        </div>

        <div className={styles.tabs} role="tablist">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.key}
              className={cx(styles.tab, activeTab === tab.key && styles.tabActive)}
              onClick={() => setActiveTab(tab.key)}
            >
              {tab.label}
              <span className={cx(styles.count, tab.danger && tab.count > 0 && styles.countDanger)}>
                {tab.count}
              </span>
            </button>
          ))}
        </div>

        <div className={styles.panel}>
          {activeTab === 'timeline' && (
            <DataTable
              columns={timelineColumns}
              rows={timeline}
              emptyText="Audit kaydı yok"
              {...selectableTableProps}
            />
          )}

          {activeTab === 'variables' && (
            <DataTable
              columns={variableColumns}
              rows={variables}
              rowKey={(v, index) => `${variableId(v)}-${index}`}
              onRowClick={(v) =>
                setExpandedVariable((current) => (current === variableId(v) ? null : variableId(v)))
              }
              isSelected={(v) => expandedVariable === variableId(v)}
              emptyText="Variable kaydı yok"
            />
          )}

          {activeTab === 'jobs' && (
            <DataTable
              columns={jobColumns}
              rows={jobs}
              emptyText="Job kaydı yok"
              {...selectableTableProps}
            />
          )}

          {activeTab === 'incidents' && (
            <DataTable
              columns={incidentColumns}
              rows={incidents}
              emptyText="Incident kaydı yok"
              {...selectableTableProps}
            />
          )}
        </div>
      </div>
    </VKGrid>
  );
};

export { BPMNProcessHistory };
