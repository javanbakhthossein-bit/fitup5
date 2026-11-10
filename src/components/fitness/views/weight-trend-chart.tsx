"use client";

/**
 * v170 — نمودار روند پیشرفت بدنی (recharts) — جدا از dashboard-view.
 * recharts ~۱۰۰KB گزیپ است؛ جدا کردنش از چانک داشبورد یعنی داشبورد بدونِ
 * کتابخانهٔ نمودار paint می‌شود و این چانک موازی/تنها-در-صدا-نیاز می‌آید
 * (دیرکتیو مالک: داشبورد مثل اپ نصب‌شده فوری و نرم).
 */
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export interface WeightTrendPoint {
  name: string;
  bodyFat: number | null;
  muscle: number | null;
  leanMass: number | null;
}

export default function WeightTrendChart({ data }: { data: WeightTrendPoint[] }) {
  return (
    <div style={{ width: "100%", height: 140 }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 5, right: 5, left: -10, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
          <XAxis
            dataKey="name"
            tick={{ fontSize: 9, fill: "#64748b" }}
            tickLine={false}
            axisLine={{ stroke: "#cbd5e1" }}
          />
          <YAxis
            tick={{ fontSize: 9, fill: "#64748b" }}
            tickLine={false}
            axisLine={{ stroke: "#cbd5e1" }}
            width={32}
          />
          <Tooltip
            contentStyle={{
              fontSize: "11px",
              borderRadius: "8px",
              border: "1px solid #fed7aa",
              background: "#fffbeb",
            }}
            labelStyle={{ color: "#92400e" }}
          />
          <Line
            type="monotone"
            dataKey="bodyFat"
            stroke="#f97316"
            strokeWidth={2.5}
            dot={{ fill: "#f97316", r: 3 }}
            activeDot={{ r: 5 }}
            name="چربی بدن"
          />
          {/* v159 (T6) — خط ٪ عضله (نقاط حکم قطعی؛ با نقاط خالی متصل می‌شود) */}
          {data.some((d) => d.muscle != null) && (
            <Line
              type="monotone"
              dataKey="muscle"
              stroke="#a855f7"
              strokeWidth={2.5}
              strokeDasharray="6 3"
              dot={{ fill: "#a855f7", r: 3 }}
              activeDot={{ r: 5 }}
              name="عضله"
              connectNulls
            />
          )}
          <Line
            type="monotone"
            dataKey="leanMass"
            stroke="#10b981"
            strokeWidth={2.5}
            dot={{ fill: "#10b981", r: 3 }}
            activeDot={{ r: 5 }}
            name="جرم خالص"
            connectNulls
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
