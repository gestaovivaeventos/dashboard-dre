import { redirect } from "next/navigation";

import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveSegment } from "@/lib/segments/resolve";

interface SegmentLayoutProps {
  children: React.ReactNode;
  params: { segmentSlug: string };
}

export default async function SegmentLayout({ children, params }: SegmentLayoutProps) {
  const { user, profile } = await getCurrentSessionContext();
  if (!user || !profile) {
    redirect("/login");
  }

  const segment = await resolveSegment(params.segmentSlug, profile);
  if (!segment) {
    redirect("/dashboard");
  }

  return <>{children}</>;
}
