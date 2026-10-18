import { withV2Log } from "@/lib/api/v2/route";
import { GET as GET_, POST as POST_, DELETE as DELETE_ } from "@paid/billing/routes/api/web/admin/vouchers/route";
export const GET = withV2Log(GET_, { route: "/api/web/admin/vouchers" });
export const POST = withV2Log(POST_, { route: "/api/web/admin/vouchers" });
export const DELETE = withV2Log(DELETE_, { route: "/api/web/admin/vouchers" });
export const dynamic = "force-dynamic";
