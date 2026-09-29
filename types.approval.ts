// ---- types.ts'in sonuna eklenecekler (Onay akışı) ----

export interface ApprovalTimeline {
  history: ApprovalHistoryItem[]; // tamamlanan onaylar, tarihe göre sıralı
  pending: ApprovalPendingItem[]; // şu an bekleyenler (paralel dallarda birden fazla olabilir)
  upcoming: ApprovalUpcomingItem[]; // deploy edilmiş XML'den çıkarılan sıradaki adımlar
}

export interface ApprovalHistoryItem {
  elementId: string;
  stepName: string;
  groupName: string;
  decision: 'Approved' | 'Rejected';
  userName: string;
  reason?: string; // redde zorunlu, onayda opsiyonel
  timestamp: string;
}

export interface ApprovalPendingItem {
  elementId: string;
  stepName: string;
  groupName: string;
  waitingSince: string;
}

export interface ApprovalUpcomingItem {
  elementId: string;
  stepName: string;
  groupName: string;
  conditionLabel?: string; // exclusive gateway sonrası dal etiketi, örn. "Tutar > 1M"
  parallel?: boolean; // parallel gateway sonrası
}

// TODO: Backend approvalTimeline döndürmeye başlayınca sil
export const MOCK_APPROVAL_TIMELINE: ApprovalTimeline = {
  history: [
    {
      elementId: 'Onay_Birim',
      stepName: 'Birim yönetici onayı',
      groupName: 'Kredi Birim Yöneticileri',
      decision: 'Approved',
      userName: 'Ahmet Yılmaz',
      timestamp: '2026-09-24T14:32:10.000Z',
    },
    {
      elementId: 'Onay_Risk',
      stepName: 'Risk onayı',
      groupName: 'Risk Analistleri',
      decision: 'Approved',
      userName: 'Zeynep Kaya',
      reason: 'Teminatlar yeterli',
      timestamp: '2026-09-25T10:05:44.000Z',
    },
  ],
  pending: [
    {
      elementId: 'Onay_Komite',
      stepName: 'Kredi komitesi onayı',
      groupName: 'Kredi Komitesi',
      waitingSince: '2026-09-25T10:05:45.000Z',
    },
  ],
  upcoming: [
    {
      elementId: 'Onay_GMY',
      stepName: 'Genel müdür yardımcısı onayı',
      groupName: 'GMY Ofisi',
      conditionLabel: 'Tutar > 1M',
    },
    {
      elementId: 'Onay_Operasyon',
      stepName: 'Operasyon onayı',
      groupName: 'Kredi Operasyon',
    },
  ],
};
