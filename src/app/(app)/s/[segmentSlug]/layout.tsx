import { redirect } from "next/navigation";

import { SegmentPlaceholder } from "@/components/app/segment-placeholder";
import { getCurrentSessionContext } from "@/lib/auth/session";
import { resolveSegment } from "@/lib/segments/resolve";

/** Only these segments have full functionality implemented */
const IMPLEMENTED_SEGMENTS = ["franquias-viva"];

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
    redirect("/admin");
  }

  if (!IMPLEMENTED_SEGMENTS.includes(segment.slug)) {
    return <SegmentPlaceholder segmentName={segment.name} />;
  }

  return <>{children}</>;
}
