import { InventoryCommentThread } from './InventoryCommentThread.jsx'

export default function InventoryDetailCommentsSection({ data }) {
  return <InventoryCommentThread itemId={data?.id} />
}
