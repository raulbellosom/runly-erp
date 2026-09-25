import { RoomChatView } from "../RoomChatView";
import { mergeRoomMessages } from "../lib/roomChat";

// Guest-side wrapper. `polled` = messages from useGuestCall state;
// `liveIncoming` = LiveKit data-channel messages accumulated by GuestCallRoom.
export function GuestRoomChat({ polled, liveIncoming, onSend, myName, onUploadFile, onResolveAttachmentUrl }) {
  return (
    <RoomChatView
      messages={mergeRoomMessages(polled, liveIncoming)}
      onSend={onSend}
      currentName={myName}
      notice="Chat de la llamada."
      onUploadFile={onUploadFile}
      onResolveAttachmentUrl={onResolveAttachmentUrl}
    />
  );
}
