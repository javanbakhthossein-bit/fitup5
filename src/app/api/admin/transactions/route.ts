import { NextRequest } from "next/server";
import { db } from "@/lib/db";
import { requireAdmin, apiError } from "@/lib/fitness/auth";
import { requireAdminPerm } from "@/lib/fitness/admin-perm";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    await requireAdminPerm("canViewFinance");
    const { searchParams } = new URL(req.url);
    // پارس امن صفحه‌بندی — Number(abc) → NaN → skip/take نامعتبر و ۵۰۰ (ممیزی 2-c)
    const page = Math.max(1, Math.floor(Number(searchParams.get("page") || 1) || 1));
    const pageSize = Math.min(100, Math.max(1, Math.floor(Number(searchParams.get("pageSize") || 20) || 20)));
    const status = searchParams.get("status") || "";
    const search = searchParams.get("search") || "";
    // v174 (درخواست مالک): فیلتر روش پرداخت — زرین‌پال / کافه‌بازار / کیف پول
    // gateway = درگاه زرین‌پال | bazaar = خرید درون‌برنامه‌ای کافه‌بازار (v124+)
    // wallet = پرداخت‌های با کیف پول + تراکنش‌های شارژ/کسر کیف پول
    const method = searchParams.get("method") || "";
    const methodValid = method && ["gateway", "bazaar", "wallet"].includes(method);
    // v252 (درخواست مالک): فیلتر درگاه پرداخت — زرین‌پال / زیبال (فقط برای روش gateway)
    const gatewayFilter = searchParams.get("gateway") || "";
    const gatewayValid = gatewayFilter && ["zarinpal", "zibal"].includes(gatewayFilter);
    // v247 (درخواست مالک): فیلتر منبع ورود + بازهٔ تاریخ
    // source روی Payment.source است (instagram | app_android | web | unknown — v171)
    const source = searchParams.get("source") || "";
    const sourceValid = source && ["instagram", "app_android", "web", "unknown"].includes(source);
    const from = searchParams.get("from") || "";
    const to = searchParams.get("to") || "";

    const where: any = {};
    // FIX: وضعیت‌های verifying (در حال پردازش) / manual_resolved / expired اضافه شدند
    // تا فیلتر منوی «مالی و تراکنش‌ها» بتواند معلق‌ها را جدا نشان دهد
    if (
      status &&
      [
        "pending",
        "success",
        "failed",
        "cancelled",
        "refunded",
        "verifying",
        "manual_resolved",
        "expired",
      ].includes(status)
    ) {
      where.status = status;
    }
    // v174 — اعمال فیلتر روش پرداخت روی پرداخت‌ها
    if (methodValid) {
      where.paymentMethod = method;
    }
    // v252 — اعمال فیلتر درگاه (زرین‌پال/زیبال). ردیف‌های قدیمیِ null = زرین‌پال؛
    // پس «زرین‌پال» یعنی (gateway=zarinpal OR gateway=null) و «زیبال» یعنی gateway=zibal.
    // ⚠️ شرط‌های OR با AND ترکیب می‌شوند تا فیلتر منبع ورود + درگاه همزمان بشکنند
    // (انتساب ساده به where.OR یکی را بازنویسی می‌کرد).
    {
      const andConds: any[] = [];
      if (gatewayValid && (!methodValid || method === "gateway")) {
        andConds.push(
          gatewayFilter === "zibal"
            ? { gateway: "zibal" }
            : { OR: [{ gateway: "zarinpal" }, { gateway: null }] }
        );
      }
      // v247 — اعمال فیلتر منبع ورود روی پرداخت‌ها (null/بدون مقدار = unknown)
      if (sourceValid) {
        andConds.push(
          source === "unknown"
            ? { OR: [{ source: null }, { source: "unknown" }] }
            : { source }
        );
      }
      if (andConds.length === 1) {
        const single = andConds[0];
        if (single.OR) where.OR = single.OR;
        else Object.assign(where, single);
      } else if (andConds.length > 1) {
        where.AND = andConds;
      }
    }
    // v247 — بازهٔ تاریخ تراکنش (from/to — ISO)
    const fromTs = from ? new Date(from) : null;
    const toTs = to ? new Date(to) : null;
    if (fromTs && !isNaN(fromTs.getTime()) && toTs && !isNaN(toTs.getTime())) {
      where.createdAt = { gte: fromTs, lte: toTs };
    } else if (fromTs && !isNaN(fromTs.getTime())) {
      where.createdAt = { gte: fromTs };
    } else if (toTs && !isNaN(toTs.getTime())) {
      where.createdAt = { lte: toTs };
    }

    // For search by user mobile/name, we need to join
    let userIds: string[] | undefined;
    if (search) {
      const users = await db.user.findMany({
        where: { OR: [{ mobile: { contains: search } }, { name: { contains: search } }] },
        select: { id: true },
      });
      userIds = users.map((u) => u.id);
      where.userId = { in: userIds };
    }

    // تراکنش‌های کیف پول فقط وقتی درخواست شده که فیلتر وضعیت نداریم (وضعیت، مفهوم پرداخت است)
    // v174: و همچنین وقتی فیلتر روشِ «کیف پول» یا بدون فیلتر است — فیلتر
    // زرین‌پال/بازار یعنی کاربر فقط پرداخت‌های آن روش را می‌خواهد نه تراکنش‌های کیف.
    // v247: فیلتر «منبع ورود» هم تراکنش‌های کیف را حذف می‌کند — رکوردهای کیف
    // source ندارند و با فیلتر منبع ورود معنا ندارند (هم‌منطق با روش پرداخت).
    // ممیزی 2-c P1: قبلاً walletTransaction.findMany هیچ where نداشت → جستجوی موبایل
    // فقط پرداخت‌ها را فیلتر می‌کرد و تراکنش‌های کیف همه‌ی کاربران را نشان می‌داد.
    const includeWallet =
      (!status || status === "all") &&
      (!methodValid || method === "wallet") &&
      !sourceValid &&
      !gatewayValid; // v252 — فیلتر درگاه هم تراکنش‌های کیف را حذف می‌کند (بی‌معنا روی کیف)
    const walletWhere: any = userIds ? { userId: { in: userIds } } : {};
    // v247 — بازهٔ تاریخ روی تراکنش‌های کیف هم اعمال شود
    if (fromTs && !isNaN(fromTs.getTime()) && toTs && !isNaN(toTs.getTime())) {
      walletWhere.createdAt = { gte: fromTs, lte: toTs };
    } else if (fromTs && !isNaN(fromTs.getTime())) {
      walletWhere.createdAt = { gte: fromTs };
    } else if (toTs && !isNaN(toTs.getTime())) {
      walletWhere.createdAt = { lte: toTs };
    }

    // ─── صفحه‌بندی درست روی استریم merge شده (ممیزی 2-c P1) ───
    // قبلاً skip/take جداگانه روی هر منبع + merge و slice بود → در ترتیب تاریخ درهم،
    // برخی ردیف‌ها هیچ‌وقت در هیچ صفحه‌ای نمایش داده نمی‌شدند.
    // حالا از هر منبع به اندازه‌ی «تا انتهای صفحه‌ی درخواستی» (page*pageSize) ردیف
    // مرتب‌شده نزولی می‌گیریم، merge و بر اساس تاریخ نزولی مرتب و پنجره‌ی صفحه را برش می‌زنیم.
    const fetchLimit = page * pageSize;

    const [paymentCount, walletCount, payments, walletTxns] = await Promise.all([
      db.payment.count({ where }),
      // total واقعی = تعداد کل هر دو منبع با همان شرط‌های فیلتر (قبلاً طول صفحه‌ی wallet بود)
      includeWallet ? db.walletTransaction.count({ where: walletWhere }) : Promise.resolve(0),
      db.payment.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: fetchLimit,
        // v214 — توکن‌های لینک امن برای تفکیک «مدال پرداخت» (فقط نیت) از
        // «در انتظار پرداخت» (واقعاً وارد جریان درگاه/لینک شده)
        include: {
          user: { select: { name: true, mobile: true, signupSource: true } },
          tokens: { select: { clickCount: true } },
        },
      }),
      includeWallet
        ? db.walletTransaction.findMany({
            where: walletWhere,
            orderBy: { createdAt: "desc" },
            take: fetchLimit,
            include: { user: { select: { name: true, mobile: true, signupSource: true } } },
          })
        : Promise.resolve([]),
    ]);

    // Combine and format — merge مرتب بر اساس تاریخ نزولی
    const transactions = [
      ...payments.map((p) => ({
        id: p.id,
        type: "payment" as const,
        userId: p.userId,
        userName: p.user?.name || "",
        userMobile: p.user?.mobile || "",
        userSource: p.user?.signupSource || null,
        amount: p.amount,
        originalAmount: p.originalAmount,
        plan: p.plan,
        paymentMethod: p.paymentMethod,
        // v252 — درگاه این تراکنش (null → زرین‌پال) برای بج و فیلتر پنل مدیر
        gateway: p.gateway === "zibal" ? "zibal" : p.paymentMethod === "gateway" ? "zarinpal" : null,
        status: p.status,
        refId: p.refId,
        authority: p.authority,
        // v214 — زیروضعیت پرداخت‌های معلق برای برچسب دقیق پنل مدیر:
        //   hasToken/tokenClicked → لینک امن صادر/باز شده، authority → درگاه باز شده
        hasToken: (p.tokens?.length ?? 0) > 0,
        tokenClicked: (p.tokens ?? []).some((tk) => tk.clickCount > 0),
        cardPan: p.cardPan || null,
        cardHash: p.cardHash || null,
        fee: p.fee ?? null,
        discountCode: p.discountCode,
        description: p.description,
        createdAt: p.createdAt.toISOString(),
        verifiedAt: p.verifiedAt?.toISOString() || null,
      })),
      ...walletTxns.map((t) => ({
        id: t.id,
        type: "wallet" as const,
        userId: t.userId,
        userName: t.user?.name || "",
        userMobile: t.user?.mobile || "",
        userSource: t.user?.signupSource || null,
        amount: t.amount,
        originalAmount: 0,
        plan: "",
        paymentMethod: "wallet",
        status: "success",
        refId: t.refId || "",
        discountCode: "",
        description: t.description,
        createdAt: t.createdAt.toISOString(),
        verifiedAt: null,
      })),
    ]
      .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      .slice((page - 1) * pageSize, page * pageSize);

    const total = paymentCount + walletCount;

    return Response.json({
      transactions,
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (e) {
    return apiError(e);
  }
}
