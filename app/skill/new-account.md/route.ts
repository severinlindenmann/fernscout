import { skillDocResponse } from "@/lib/api/skillRoute";

export function GET() {
  return skillDocResponse("new-account");
}
