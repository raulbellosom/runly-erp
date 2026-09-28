// Representative lucide icon per Module Builder field type, shared by the
// field list rows and the type picker in FieldSheet.
import {
  Type,
  AlignLeft,
  Hash,
  Percent,
  ToggleLeft,
  CircleDot,
  ListChecks,
  Calendar,
  CalendarClock,
  Mail,
  Phone,
  Link2,
  Paperclip,
  Braces,
  FileText,
  Palette,
  Pilcrow,
} from "lucide-react";

export const DEFAULT_FIELD_ICON = Type;

export const FIELD_TYPE_ICONS = {
  text: Type, textarea: AlignLeft, number: Hash, decimal: Percent,
  boolean: ToggleLeft, select: CircleDot, multiselect: ListChecks,
  date: Calendar, datetime: CalendarClock, email: Mail, phone: Phone,
  relation: Link2, file: Paperclip, json: Braces, markdown: FileText,
  color: Palette, richtext: Pilcrow,
};
