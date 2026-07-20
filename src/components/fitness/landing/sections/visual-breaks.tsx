"use client";

import { motion } from "framer-motion";

const goldGradient = "linear-gradient(135deg, #f59e0b, #f97316)";

/**
 * Stats Banner — visual break between sections.
 * A wide gradient strip showing 4 quick stats.
 */
export function StatsBanner({
  items,
  variant = "light",
}: {
  items: string[];
  variant?: "light" | "dark";
}) {
  const isDark = variant === "dark";
  return (
    <section
      className="py-4 sm:py-6 relative overflow-hidden"
      style={{
        background: isDark
          ? "linear-gradient(135deg, #f59e0b, #f97316)"
          : "linear-gradient(135deg, #fff7ed, #ffedd5)",
      }}
    >
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-center gap-3 sm:gap-8 overflow-x-auto no-scrollbar">
          {items.map((item, i) => (
            <motion.div
              key={i}
              initial={{ opacity: 0, y: 10 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: "-100px" }}
              transition={{ delay: i * 0.08, duration: 0.4 }}
              className="flex items-center gap-2 sm:gap-3 shrink-0"
            >
              {i > 0 && (
                <span
                  className="hidden sm:inline-block w-1 h-1 rounded-full"
                  style={{
                    background: isDark ? "rgba(255,255,255,0.5)" : "#fdba74",
                  }}
                />
              )}
              <span
                className={`text-sm sm:text-base font-black whitespace-nowrap ${
                  isDark ? "text-white" : "text-orange-600"
                }`}
              >
                {item}
              </span>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Emoji Divider — a decorative emoji banner between sections.
 * Adds visual variety with bouncing emojis.
 */
export function EmojiDivider({
  emojis,
}: {
  emojis: string[];
}) {
  return (
    <section className="py-3 sm:py-4 bg-white">
      <div className="max-w-6xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-center gap-4 sm:gap-8">
          {emojis.map((e, i) => (
            <motion.div
              key={i}
              animate={{ y: [0, -8, 0] }}
              transition={{
                duration: 1.8,
                repeat: Infinity,
                ease: "easeInOut",
                delay: i * 0.2,
              }}
              className="text-2xl sm:text-3xl"
            >
              {e}
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  );
}

/**
 * Decorative gradient strip — small thin separator.
 */
export function GradientStrip() {
  return (
    <div
      className="h-1 w-full"
      style={{ background: goldGradient }}
    />
  );
}
