// Lib
export { cn } from "./lib/utils.js";

// Core primitives
export { Button, buttonVariants } from "./components/Button.jsx";
export {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "./components/Card.jsx";
export { Badge, badgeVariants } from "./components/Badge.jsx";
export { TypeBadge } from "./components/TypeBadge.jsx";
export { Separator } from "./components/Separator.jsx";
export { Skeleton } from "./components/Skeleton.jsx";
export { ProgressBar } from "./components/ProgressBar.jsx";
export { LoadingState } from "./components/LoadingState.jsx";
export { Avatar, AvatarImage, AvatarFallback } from "./components/Avatar.jsx";
export { AuthAtmosphere } from "./components/AuthAtmosphere.jsx";

// Forms
export { Label } from "./components/Label.jsx";
export { Input } from "./components/Input.jsx";
export { Textarea } from "./components/Textarea.jsx";
export {
  FieldWrapper,
  TextField,
  PasswordField,
  TextareaField,
  NumberField,
  CurrencyField,
  DateField,
  DateTimeField,
  YearField,
  DropzoneField,
  SelectField,
  PhoneField,
  CheckboxField,
  SwitchField,
  RadioGroupField,
  TagsField,
  ComboboxField,
  CreatableComboboxField,
  CarColorPickerField,
  RelationSelectField,
} from "./components/FormFields.jsx";
export { MarkdownField } from "./components/MarkdownField.jsx";
export { MarkdownViewer } from "./components/MarkdownViewer.jsx";
export { SortableList } from "./components/SortableList.jsx";
export { Checkbox } from "./components/Checkbox.jsx";
export { Switch } from "./components/Switch.jsx";
export {
  Select,
  SelectGroup,
  SelectValue,
  SelectTrigger,
  SelectContent,
  SelectLabel,
  SelectItem,
  SelectSeparator,
  SelectScrollUpButton,
  SelectScrollDownButton,
} from "./components/Select.jsx";
export {
  Form,
  FormField,
  FormItem,
  FormLabel,
  FormControl,
  FormDescription,
  FormMessage,
  useFormField,
} from "./components/Form.jsx";

// Navigation & Layout
export { AppShell } from "./components/AppShell.jsx";
export { ModuleSidebar } from "./components/ModuleSidebar.jsx";
export {
  FleetVehicleIcon,
  ModuleNavIcon,
  resolveModuleIcon,
  getModuleIconComponent,
} from "./components/module-icon-registry.jsx";
export {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "./components/Tabs.jsx";
export {
  Accordion,
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "./components/Accordion.jsx";
export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuGroup,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuRadioGroup,
} from "./components/DropdownMenu.jsx";
export {
  ContextMenu,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuCheckboxItem,
  ContextMenuRadioItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuGroup,
  ContextMenuPortal,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuRadioGroup,
} from "./components/ContextMenu.jsx";
export { SwipeableRow } from "./components/SwipeableRow.jsx";
export {
  Breadcrumb,
  BreadcrumbList,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbPage,
  BreadcrumbSeparator,
  BreadcrumbEllipsis,
} from "./components/Breadcrumb.jsx";

// Data Display
export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
} from "./components/Table.jsx";
export { DataTable } from "./components/DataTable.jsx";
export {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationPrevious,
  PaginationNext,
  PaginationEllipsis,
} from "./components/Pagination.jsx";

// Overlays & Feedback
export {
  Dialog,
  DialogPortal,
  DialogOverlay,
  DialogTrigger,
  DialogClose,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogTitle,
  DialogDescription,
} from "./components/Dialog.jsx";
export {
  Sheet,
  SheetPortal,
  SheetOverlay,
  SheetTrigger,
  SheetClose,
  SheetContent,
  SheetHeader,
  SheetFooter,
  SheetTitle,
  SheetDescription,
} from "./components/Sheet.jsx";
export {
  Popover,
  PopoverTrigger,
  PopoverContent,
  PopoverAnchor,
} from "./components/Popover.jsx";
export {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
  TooltipProvider,
} from "./components/Tooltip.jsx";
export { Toaster } from "./components/Toast.jsx";
export { Alert, AlertTitle, AlertDescription } from "./components/Alert.jsx";

// Molecules & Organisms
export { DatePickerField } from "./components/DatePickerField.jsx";
export { PageHeader } from "./components/PageHeader.jsx";
export { UnsavedChangesBar } from "./components/UnsavedChangesBar.jsx";
export { EmptyState } from "./components/EmptyState.jsx";
export { ErrorState } from "./components/ErrorState.jsx";
export { StatCard } from "./components/StatCard.jsx";
export { StatStrip } from "./components/StatStrip.jsx";
export { DetailHero } from "./components/DetailHero.jsx";
export { FormCompletionRing } from "./components/FormCompletionRing.jsx";
export { FormPreviewPanel } from "./components/FormPreviewPanel.jsx";
export { SwatchField, DEFAULT_SWATCHES } from "./components/SwatchField.jsx";
export { ProgressMeter } from "./components/ProgressMeter.jsx";
export { RingProgress } from "./components/RingProgress.jsx";
export { SectionCard } from "./components/SectionCard.jsx";
export { DetailActionBar } from "./components/DetailActionBar.jsx";
export { SearchInput } from "./components/SearchInput.jsx";
export { FilterBar } from "./components/FilterBar.jsx";
export { IconPickerField } from "./components/IconPickerField.jsx";
export { ICON_CATALOG, resolveLucideIcon } from "./components/icon-catalog.js";
export { DynamicTable } from "./components/DynamicTable.jsx";
export { DynamicForm } from "./components/DynamicForm.jsx";
export { ActionMenu } from "./components/ActionMenu.jsx";
export { ConfirmDialog } from "./components/ConfirmDialog.jsx";
export { ContactPicker } from "./components/ContactPicker.jsx";
export { FileCard } from "./components/FileCard.jsx";
export { DistDropZone } from "./components/DistDropZone.jsx";
export { FileUploader } from "./components/FileUploader.jsx";
export { FileViewer } from "./components/FileViewer.jsx";
export { AdvancedFileViewer } from "./components/AdvancedFileViewer.jsx";
export { FileVisual } from "./components/FileVisual.jsx";
export {
  getFileKind,
  getKindLabel,
  getKindAccent,
  formatBytes,
  formatDate,
} from "./lib/file-kind.js";
export { AttachmentsPanel } from "./components/AttachmentsPanel.jsx";
export { DocumentsPanel } from "./components/DocumentsPanel.jsx";
export { ImageViewer } from "./components/ImageViewer.jsx";
export { ImageUploader } from "./components/ImageUploader.jsx";
export { PageFooter } from "./components/PageFooter.jsx";
export { BrandFooter } from "./components/BrandFooter.jsx";

// Responsive / Mobile patterns
export {
  ViewModeSwitch,
  getStoredViewMode,
} from "./components/ViewModeSwitch.jsx";
export { MobileFiltersSheet } from "./components/MobileFiltersSheet.jsx";
export { ListLayout } from "./components/ListLayout.jsx";
export { useAttachmentsController, resolveAttachmentFileType } from "./hooks/useAttachmentsController.js";
export { useIsMobile } from "./hooks/useIsMobile.js";
export { useCoarsePointer, useHasHover } from "./hooks/usePointerCapabilities.js";
export { useIsolatedScroll } from "./hooks/useIsolatedScroll.js";
export { useLongPress, createLongPressController } from "./hooks/useLongPress.js";
export { useSwipeToReply, createSwipeController } from "./hooks/useSwipeToReply.js";

// runly.activity
export { ActivityTimeline } from "./components/ActivityTimeline.jsx";
export { ActivityDrawer } from "./components/ActivityDrawer.jsx";
export { ActivityBellTrigger } from "./components/ActivityBellTrigger.jsx";

// Runly blueprint renderer
export {
  RunlyTable,
  RunlyForm,
  RunlyDetail,
  RunlyCrudView,
  RunlyCardView,
  BulkActionBar,
  normalizeSpanishLabel,
  shouldUsePageMode,
  CostsSummaryPanel,
} from "./runly-renderer/index.js";

export { UserSearchModal } from "./components/UserSearchModal.jsx";

export {
  default as MentionTextarea,
  renderMentionText,
  parseMentionIds,
} from "./components/MentionTextarea.jsx";
export { CommentThread } from "./components/CommentThread.jsx";

export { OfflineIndicator } from "./components/OfflineIndicator.jsx";
export { SyncStatusBar } from "./components/SyncStatusBar.jsx";
export { SyncStatusPopover } from "./components/SyncStatusPopover.jsx";
export { PendingMutationsPanel } from "./components/PendingMutationsPanel.jsx";
export { ConflictDialog } from "./components/ConflictDialog.jsx";

export { OfficeDocumentEditor } from "./components/OfficeDocumentEditor.jsx";
export { OfficeAttachmentAction } from "./components/OfficeAttachmentAction.jsx";
export { OfficeActionsContext, useOfficeActions } from "./components/office-actions-context.js";
