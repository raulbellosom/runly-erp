import { useAuth } from "../../../auth/AuthProvider";
import UserPermissionGrantsCard from "./UserPermissionGrantsCard";

export default function PermissionGrantsSection({ data, token }) {
  const { userProfile } = useAuth();
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) => Boolean(userProfile?.isAdmin || permissions.includes(key));
  const canManageUsers = hasPermission("identity.users.update");
  const canManageGrants = hasPermission("identity.permissions.update") && canManageUsers;

  if (!canManageGrants || !data?.id) return null;

  return <UserPermissionGrantsCard userId={data.id} token={token} canManage={canManageUsers} />;
}
