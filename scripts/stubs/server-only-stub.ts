// فقط برای اسکریپت‌های راستی‌آزمایی bun خارج از Next — پکیج server-only در
// محیط RSC معنا دارد و خارج از آن throw می‌کند؛ اینجا بی‌اثرش می‌کنیم.
import { plugin } from "bun";

plugin({
  name: "server-only-stub-verify",
  setup(build) {
    build.module("server-only", () => ({
      exports: {},
      loader: "object",
    }));
  },
});
