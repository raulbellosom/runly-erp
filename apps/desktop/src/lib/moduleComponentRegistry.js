import { createModuleComponentRegistry } from "./module-component-registry-core.js";

// runly.fleet static cell components (migrated from bundle to static import)
import VehicleStatusBadge from "../modules/runly.fleet/components/VehicleStatusBadge.jsx";
import DriverStatusBadge from "../modules/runly.fleet/components/DriverStatusBadge.jsx";
import DriverLicenseBadge from "../modules/runly.fleet/components/DriverLicenseBadge.jsx";
import ReportStatusBadge from "../modules/runly.fleet/components/ReportStatusBadge.jsx";
import DriverAvatarCell from "../modules/runly.fleet/components/DriverAvatarCell.jsx";
import DriverAssignedVehicleCell from "../modules/runly.fleet/components/DriverAssignedVehicleCell.jsx";
import VehicleImageCell from "../modules/runly.fleet/components/VehicleImageCell.jsx";
import InsuranceBadgeCell from "../modules/runly.fleet/components/InsuranceBadgeCell.jsx";
import CoverageTypeBadge from "../modules/runly.fleet/components/CoverageTypeBadge.jsx";
import FleetVehicleHistorySection from "../modules/runly.fleet/components/FleetVehicleHistorySection.jsx";

import LeadStatusBadge from "../modules/runly.growth/components/LeadStatusBadge.jsx";
import LeadPriorityBadge from "../modules/runly.growth/components/LeadPriorityBadge.jsx";

import InventoryDetailAssignmentSection from "../modules/runly.inventory/components/InventoryDetailAssignmentSection.jsx";
import InventoryDetailCommentsSection from "../modules/runly.inventory/components/InventoryDetailCommentsSection.jsx";
import InventoryDetailHistorySection from "../modules/runly.inventory/components/InventoryDetailHistorySection.jsx";

import HrEmployeeActivityPanel from "../modules/runly.hr/components/HrEmployeeActivityPanel.jsx";
import OrgChartSection from "../modules/runly.hr/components/OrgChartSection.jsx";
import AssignedEquipmentSection from "../modules/runly.hr/components/AssignedEquipmentSection.jsx";

import { AddressFieldsSection } from "@runly/ui";

import MembershipsSection from "../modules/runly.identity/components/MembershipsSection.jsx";
import PermissionGrantsSection from "../modules/runly.identity/components/PermissionGrantsSection.jsx";
import UserActivitySection from "../modules/runly.identity/components/UserActivitySection.jsx";
import UserSessionSection from "../modules/runly.identity/components/UserSessionSection.jsx";
import PermissionTreeSection from "../modules/runly.identity/components/PermissionTreeSection.jsx";
import RoleMembersSection from "../modules/runly.identity/components/RoleMembersSection.jsx";

const _isDev = Boolean(import.meta.env?.DEV);

function warnDev(message) {
  if (_isDev) {
    console.warn(`[moduleComponentRegistry] ${message}`);
  }
}

export const componentRegistry = createModuleComponentRegistry({
  warn: warnDev,
});

// Static registration for runly.fleet core module components
componentRegistry.register(
  "runly.fleet:VehicleStatusBadge",
  VehicleStatusBadge,
);
componentRegistry.register("runly.fleet:DriverStatusBadge", DriverStatusBadge);
componentRegistry.register("runly.fleet:DriverLicenseBadge", DriverLicenseBadge);
componentRegistry.register("runly.fleet:ReportStatusBadge", ReportStatusBadge);
componentRegistry.register("runly.fleet:DriverAvatarCell", DriverAvatarCell);
componentRegistry.register(
  "runly.fleet:DriverAssignedVehicleCell",
  DriverAssignedVehicleCell,
);
componentRegistry.register("runly.fleet:VehicleImageCell", VehicleImageCell);
componentRegistry.register(
  "runly.fleet:InsuranceBadgeCell",
  InsuranceBadgeCell,
);
componentRegistry.register("runly.fleet:CoverageTypeBadge", CoverageTypeBadge);
componentRegistry.register(
  "runly.fleet:HistorySection",
  FleetVehicleHistorySection,
);

componentRegistry.register("runly.growth:LeadStatusBadge", LeadStatusBadge);
componentRegistry.register("runly.growth:LeadPriorityBadge", LeadPriorityBadge);

componentRegistry.register(
  "runly.inventory:AssignmentSection",
  InventoryDetailAssignmentSection,
);
componentRegistry.register(
  "runly.inventory:CommentsSection",
  InventoryDetailCommentsSection,
);
componentRegistry.register(
  "runly.inventory:HistorySection",
  InventoryDetailHistorySection,
);

componentRegistry.register("runly.hr:HistorySection", HrEmployeeActivityPanel);
componentRegistry.register("runly.hr:OrgChartSection", OrgChartSection);
componentRegistry.register(
  "runly.hr:AssignedEquipmentSection",
  AssignedEquipmentSection,
);

componentRegistry.register(
  "runly.identity:AddressFieldsSection",
  AddressFieldsSection,
);
componentRegistry.register(
  "runly.identity:MembershipsSection",
  MembershipsSection,
);
componentRegistry.register(
  "runly.identity:PermissionGrantsSection",
  PermissionGrantsSection,
);
componentRegistry.register(
  "runly.identity:UserActivitySection",
  UserActivitySection,
);
componentRegistry.register(
  "runly.identity:UserSessionSection",
  UserSessionSection,
);
componentRegistry.register(
  "runly.identity:PermissionTreeSection",
  PermissionTreeSection,
);
componentRegistry.register(
  "runly.identity:RoleMembersSection",
  RoleMembersSection,
);

// Dynamic bundle registration is done at runtime by ModuleBundleLoader
// for modules that still use the bundle system (has_bundle=true).
// See apps/desktop/src/shell/ModuleBundleLoader.jsx
