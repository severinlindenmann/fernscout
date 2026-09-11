import { skillDocResponse } from "@/lib/api/skillRoute";

export function GET() {
  return skillDocResponse("send-postcards");
}
