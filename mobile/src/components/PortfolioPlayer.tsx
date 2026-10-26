import { MediaViewer } from "@/components/MediaViewer";

export function PortfolioPlayer({ url, title, onClose }: { url: string; title: string; onClose: () => void }) {
  return <MediaViewer source={{ kind: "url", url }} title={title} onClose={onClose} backLabel="Back to profile" />;
}
