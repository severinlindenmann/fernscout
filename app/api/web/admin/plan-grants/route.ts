import { withV2Log } from "@/lib/api/v2/route";
import { GET as GET_, POST as POST_, DELETE as DELETE_, PATCH as PATCH_ } from "@paid/billing/routes/api/web/admin/plan-grants/route";
export const GET = withV2Log(GET_, { route: "/api/web/admin/plan-grants" });
export const POST = withV2Log(POST_, { route: "/api/web/admin/plan-grants" });
export const DELETE = withV2Log(DELETE_, { route: "/api/web/admin/plan-grants" });
export const PATCH = withV2Log(PATCH_, { route: "/api/web/admin/plan-grants" });
export const dynamic = "force-dynamic";
