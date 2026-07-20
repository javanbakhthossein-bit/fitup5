import { cookies } from "next/headers";
import { getCurrentUser, apiError, buildUserDto } from "@/lib/fitness/auth";

// Marker cookie name — must match the one set in lib/fitness/auth.ts
const TERMS_PENDING_COOKIE = "sc_terms_pending";

export async function GET() {
  try {
    const user = await getCurrentUser();
    const cookieStore = await cookies();
    // NOTE: next/headers cookies() reflects mutations done within the same
    // request (e.g. by getCurrentUser), so this read picks up the marker
    // cookie even if it was just set in this same request.
    const termsPending = cookieStore.get(TERMS_PENDING_COOKIE)?.value === "1";

    if (!user) {
      // If the marker cookie is set, the user was logged out due to
      // outdated TermsVersion — tell the frontend to show the modal.
      if (termsPending) {
        return Response.json(
          { user: null, termsUpdateRequired: true },
          { status: 200 }
        );
      }
      return Response.json({ user: null }, { status: 200 });
    }
    const dto = await buildUserDto(user.id);
    return Response.json({ user: dto });
  } catch (e) {
    return apiError(e);
  }
}
