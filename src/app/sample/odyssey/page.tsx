import { OdysseySampleView } from "@/components/OdysseySampleView";

export const dynamic = "force-static";

export const metadata = {
  title: "SAMPLE · 오딧세이",
  robots: { index: false, follow: false },
};

export default function OdysseySamplePage() {
  return <OdysseySampleView />;
}
