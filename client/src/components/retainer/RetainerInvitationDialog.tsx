import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useAuth } from "@/components/AuthProvider";
import { CustomProposal, useCustomRetainer } from "./CustomRetainerWorkspace";

export default function RetainerInvitationDialog({ publicId, onClose }: { publicId: string; onClose: () => void }) {
  const { user } = useAuth();
  const { data, isLoading, isError, refetch } = useCustomRetainer(publicId, !!user);
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="z-[250] max-w-3xl max-h-[90vh] overflow-y-auto">
      <DialogHeader>
        <DialogTitle>Retainer proposal</DialogTitle>
        <DialogDescription>Review the scope, dates, cycle prices and payment terms before responding.</DialogDescription>
      </DialogHeader>
      {isLoading && <p role="status">Loading proposal…</p>}
      {isError && <div role="alert"><p>Unable to load this proposal.</p><button onClick={() => refetch()}>Try again</button></div>}
      {data && user && <CustomProposal publicId={publicId} data={data} userId={user.id} />}
      <a className="text-primary underline" href={`/#/retainer/${encodeURIComponent(publicId)}`} onClick={onClose}>Open full retainer</a>
    </DialogContent>
  </Dialog>;
}
