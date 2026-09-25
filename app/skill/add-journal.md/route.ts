import { skillDocResponse } from "@/lib/api/skillRoute";

export function GET() {
  return skillDocResponse("add-journal");
}
