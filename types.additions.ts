// ---- types.ts'in sonuna eklenecekler ----
// Not: types.ts zaten React.CSSProperties kullandığı için React.ReactNode ek import gerektirmez.

export const DIAGRAM_HEIGHT = 400;

export interface Tone {
  bg: string;
  color: string;
}

export const NEUTRAL_TONE: Tone = { bg: '#f0f0f0', color: '#333' };
export const DANGER_TONE: Tone = { bg: '#fff2f0', color: '#a32d2d' };
export const VARIABLE_INTENT_TONE: Tone = { bg: '#e6f7ff', color: '#0958d9' };

export const INSTANCE_STATE_STYLES: Record<string, Tone> = {
  Completed: { bg: '#f0fde8', color: '#3b6d11' },
  Active: { bg: '#e6f7ff', color: '#0958d9' },
  Terminated: DANGER_TONE,
};

// Audit, job ve incident satırlarının ortak kesişimi: detay paneli ve seçim bunu kullanır
export interface SelectableEvent {
  elementId?: string;
  intent?: string;
  bpmnElementType?: string;
  type?: string;
  timestamp?: string;
  key?: number;
  position: number;
  partitionId?: number;
}

// DataTable kolon tanımı
export interface Column<T> {
  key: string;
  header: string;
  width?: number | string;
  className?: string;
  render: (row: T) => React.ReactNode;
}
