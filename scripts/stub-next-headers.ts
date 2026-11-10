// استاب next/headers و server-only برای اجرای اسکریپت‌های تست بیرون از Next runtime
// (فقط برای scripts/test-* — هرگز در باندل تولید وارد نمی‌شود)
import { plugin } from "bun";

plugin({
  name: "stub-server-modules-for-tests",
  setup(build) {
    build.module("server-only", () => ({ exports: {}, loader: "object" }));
    build.module("next/headers", () => ({
      exports: {
        cookies: () => ({
          get: () => undefined,
          getAll: () => [],
          set: () => {},
          delete: () => {},
        }),
        headers: () => new Headers(),
      },
      loader: "object",
    }));
  },
});
