/**
 * ─────────────────────────────────────────────────────────────────────────────
 * Task 4 — گروه‌بندی رسانه/تحلیل‌های کاربر بر اساس دورهٔ پلن (Subscription)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * درخواست مالک: کاربر در هر دورهٔ اشتراک (تمدید/ارتقا) عکس/ویدیوی بدن و آزمایش
 * خون جدید آپلود می‌کند؛ پرونده ورزشی باید هر دوره را جدا نشان دهد.
 *
 * منطق (pure — بدون وابستگی به Next/Prisma تا با bun هم تست‌پذیر باشد):
 *   • گروه‌ها از روی ردیف‌های Subscription ساخته می‌شوند، مرتب صعودی بر اساس
 *     COALESCE(startDate, createdAt) — پلن pending (startDate=null) با تاریخ
 *     خریدش گروه می‌شود.
 *   • پنجرهٔ هر گروه = [startedAt_i، startedAt_{i+1})؛ گروه آخر باز است تا
 *     آیتم‌های بعد از endDate هم در دورهٔ جاری بمانند و یتیم نشوند.
 *   • هر AnalysisResult (بدن/ویدیو/خون) با createdAt و هر ProgressPhoto با
 *     takenAt (این مدل createdAt ندارد) به گروهی می‌رود که پنجره‌اش آن زمان را
 *     می‌گیرد؛ آیتم قدیمی‌تر از اولین پلن → گروه «پیش از اولین پلن» — فقط وقتی
 *     چنین آیتمی واقعاً وجود دارد.
 *   • داخل هر گروه صعودی مرتب می‌شود (قدیمی‌ترین اول) تا شماره‌گذاری
 *     «تحلیل عکس اول/دوم/…» در UI با ترتیب واقعی آپلود بخواند.
 */

/** برچسب فارسی پلن‌ها (کپی محلی از PLAN_LABELS — این فایل وابستگی ندارد) */
const PLAN_LABELS_FA: Record<string, string> = {
  basic: "اقتصادی",
  standard: "استاندارد",
  advanced: "پیشرفته",
  ultimate: "حرفه‌ای",
};

/** «مهر ۱۴۰۵» — ماه/سال شمسی برای برچسب دورهٔ پلن */
function faMonthYear(d: Date): string {
  try {
    return new Intl.DateTimeFormat("fa-IR", { month: "long", year: "numeric" }).format(d);
  } catch {
    return "";
  }
}

/** شکل آیتم تحلیل (عین خروجی flat /api/user-media) */
export interface MediaAnalysisItem {
  id: string;
  mediaUrl: string | null;
  result: any;
  createdAt: string;
}

/** شکل آیتم عکس بدن (عین خروجی flat /api/user-media) */
export interface ProgressPhotoItem {
  id: string;
  imageUrl: string;
  type: string;
  note: string;
  takenAt: string;
}

/** حداقل فیلدهای Subscription لازم برای گروه‌بندی */
export interface SubscriptionLike {
  id: string;
  plan: string;
  startDate: Date | null;
  endDate: Date | null;
  createdAt: Date;
}

export interface PlanGroupDto {
  id: string;
  plan: string | null;
  planLabel: string;
  startedAt: string | null;
  endedAt: string | null;
  label: string;
  counts: { photos: number; bodyAnalyses: number; videoAnalyses: number; bloodTests: number };
  bodyPhotos: ProgressPhotoItem[];
  bodyAnalyses: MediaAnalysisItem[];
  videoAnalyses: MediaAnalysisItem[];
  bloodTests: MediaAnalysisItem[];
}

export interface PlanGroupsInput {
  subscriptions: SubscriptionLike[];
  bodyAnalyses: MediaAnalysisItem[];
  videoAnalyses: MediaAnalysisItem[];
  bloodTests: MediaAnalysisItem[];
  bodyPhotos: ProgressPhotoItem[];
}

export function buildPlanMediaGroups(input: PlanGroupsInput): PlanGroupDto[] {
  const { subscriptions, bodyAnalyses, videoAnalyses, bloodTests, bodyPhotos } = input;

  // مرتب صعودی بر اساس COALESCE(startDate, createdAt)
  const sortedSubs = [...subscriptions].sort(
    (a, b) =>
      (a.startDate ?? a.createdAt).getTime() - (b.startDate ?? b.createdAt).getTime()
  );

  const groups: PlanGroupDto[] = sortedSubs.map((s, i) => {
    const started = s.startDate ?? s.createdAt;
    // پایان پنجرهٔ گروه = شروع گروه بعدی؛ برای گروه آخر = endDate خودش
    // (می‌تواند null باشد — پنجرهٔ گروه آخر در تخصیص باز فرض می‌شود)
    const nextStarted = sortedSubs[i + 1]
      ? (sortedSubs[i + 1].startDate ?? sortedSubs[i + 1].createdAt)
      : null;
    const ended = nextStarted ?? s.endDate;
    const planLabel = PLAN_LABELS_FA[s.plan] ?? s.plan;
    return {
      id: s.id,
      plan: s.plan,
      planLabel,
      startedAt: started.toISOString(),
      endedAt: ended ? ended.toISOString() : null,
      label: `پلن ${planLabel} — ${faMonthYear(started)}`,
      counts: { photos: 0, bodyAnalyses: 0, videoAnalyses: 0, bloodTests: 0 },
      bodyPhotos: [],
      bodyAnalyses: [],
      videoAnalyses: [],
      bloodTests: [],
    };
  });

  // یافتن گروه هر آیتم: آخرین گروهی که startedAt ≤ زمان آیتم (پنجره‌ها پشت
  // سرهم‌اند و گروه آخر باز است) — هیچ گروهی → «پیش از اولین پلن»
  const findGroupIndex = (timeMs: number): number => {
    for (let i = groups.length - 1; i >= 0; i--) {
      if (new Date(groups[i].startedAt as string).getTime() <= timeMs) return i;
    }
    return -1;
  };

  const prePlanGroup: PlanGroupDto = {
    id: "pre-plan",
    plan: null,
    planLabel: "پیش از اولین پلن",
    startedAt: null,
    endedAt: groups.length > 0 ? groups[0].startedAt : null,
    label: "پیش از اولین پلن",
    counts: { photos: 0, bodyAnalyses: 0, videoAnalyses: 0, bloodTests: 0 },
    bodyPhotos: [],
    bodyAnalyses: [],
    videoAnalyses: [],
    bloodTests: [],
  };

  const assignAnalysis = (item: MediaAnalysisItem, bucket: (g: PlanGroupDto) => MediaAnalysisItem[]) => {
    const idx = findGroupIndex(new Date(item.createdAt).getTime());
    bucket(idx === -1 ? prePlanGroup : groups[idx]).push(item);
  };
  const assignPhoto = (item: ProgressPhotoItem) => {
    // ProgressPhoto فیلد createdAt ندارد — takenAt (پیش‌فرض now) لحظهٔ ثبت است
    const idx = findGroupIndex(new Date(item.takenAt).getTime());
    (idx === -1 ? prePlanGroup : groups[idx]).bodyPhotos.push(item);
  };

  for (const a of bodyAnalyses) assignAnalysis(a, (g) => g.bodyAnalyses);
  for (const a of videoAnalyses) assignAnalysis(a, (g) => g.videoAnalyses);
  for (const a of bloodTests) assignAnalysis(a, (g) => g.bloodTests);
  for (const p of bodyPhotos) assignPhoto(p);

  // داخل هر گروه صعودی — شماره‌گذاری «اول/دوم/…» با ترتیب واقعی آپلود
  const asc = (a: { t: number }, b: { t: number }) => a.t - b.t;
  const finalize = (g: PlanGroupDto) => {
    g.bodyAnalyses.sort((a, b) => asc({ t: +new Date(a.createdAt) }, { t: +new Date(b.createdAt) }));
    g.videoAnalyses.sort((a, b) => asc({ t: +new Date(a.createdAt) }, { t: +new Date(b.createdAt) }));
    g.bloodTests.sort((a, b) => asc({ t: +new Date(a.createdAt) }, { t: +new Date(b.createdAt) }));
    g.bodyPhotos.sort((a, b) => asc({ t: +new Date(a.takenAt) }, { t: +new Date(b.takenAt) }));
    g.counts = {
      photos: g.bodyPhotos.length,
      bodyAnalyses: g.bodyAnalyses.length,
      videoAnalyses: g.videoAnalyses.length,
      bloodTests: g.bloodTests.length,
    };
  };
  groups.forEach(finalize);

  const planGroups: PlanGroupDto[] = [...groups];
  // گروه «پیش از اولین پلن» فقط وقتی آیتم واقعی دارد — گروه خالی بی‌معنی است
  // (نکته: counts داخل finalize محاسبه می‌شود — اول finalize، بعد چک)
  finalize(prePlanGroup);
  if (
    prePlanGroup.counts.photos + prePlanGroup.counts.bodyAnalyses +
    prePlanGroup.counts.videoAnalyses + prePlanGroup.counts.bloodTests > 0
  ) {
    planGroups.unshift(prePlanGroup);
  }

  return planGroups;
}
