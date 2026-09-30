import { useEffect, useRef } from "react";
import { Track } from "livekit-client";

// Rendered by CallRoom (not the layout) so remote audio keeps playing while the
// call is minimized to MiniCallBubble.
export function RemoteAudio({ participant }) {
  const audioRef = useRef(null);
  const publication = participant?.getTrackPublication?.(Track.Source.Microphone);
  const track = publication?.track;

  useEffect(() => {
    const element = audioRef.current;
    if (!track || !element) return undefined;
    track.attach(element);
    return () => track.detach(element);
  }, [track]);

  // react-doctor-disable-next-line media-has-caption no-autoplay-without-muted -- This is live call audio after explicit acceptance; muting it would break the call.
  return <audio ref={audioRef} autoPlay />;
}
