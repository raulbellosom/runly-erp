import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  PageHeader,
  PasswordField,
  SelectField,
  TextField,
} from "@runly/ui";
import { ArrowLeft, KeyRound, Mail, Shield, UserRound } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "../../../auth/AuthProvider";
import { runly } from "../../../lib/runly";

const NO_ROLE_VALUE = "__none__";

export default function UserCreateScreen() {
  const { session, userProfile } = useAuth();
  const navigate = useNavigate();
  const token = session?.access_token;
  const permissions = userProfile?.permissions ?? [];
  const hasPermission = (key) =>
    Boolean(userProfile?.isAdmin || permissions.includes(key));
  const canManageUsers = hasPermission("identity.users.create");
  const canReadRoles = hasPermission("identity.roles.read");
  const queryClient = useQueryClient();

  const rolesQuery = useQuery({
    queryKey: ["identity-roles"],
    queryFn: () => runly.identity.listRoles(token),
    enabled: Boolean(token) && canReadRoles,
  });

  const [invitationUrl, setInvitationUrl] = useState(null);
  const [form, setForm] = useState({
    firstName: "",
    lastName: "",
    email: "",
    password: "",
    confirmPassword: "",
    roleId: NO_ROLE_VALUE,
  });

  const roleOptions = useMemo(
    () => [
      { value: NO_ROLE_VALUE, label: "Sin rol" },
      ...(rolesQuery.data?.data ?? []).map((role) => ({
        value: role.id,
        label: role.name,
      })),
    ],
    [rolesQuery.data],
  );

  const createUserMutation = useMutation({
    mutationFn: (payload) => runly.identity.createUser(payload, token),
    onSuccess: ({ data }) => {
      queryClient.invalidateQueries({ queryKey: ["identity-users"] });
      toast.success("Invitacion preparada");
      setInvitationUrl(new URL(data.invitationUrl, window.location.origin).href);
    },
    onError: (err) => {
      try {
        const msg = JSON.parse(err?.message || "{}").error;
        toast.error(msg || "No se pudo crear el usuario");
      } catch {
        toast.error("No se pudo crear el usuario");
      }
    },
  });

  function handleSubmit() {
    const payload = {
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      email: form.email.trim(),
      password: form.password,
    };
    if (form.roleId && form.roleId !== NO_ROLE_VALUE) {
      payload.roleId = form.roleId;
    }
    createUserMutation.mutate(payload);
  }

  const isValid =
    form.firstName.trim().length > 0 &&
    form.lastName.trim().length > 0 &&
    form.email.trim().length > 0 &&
    form.password.length >= 8 &&
    form.confirmPassword.length > 0 &&
    form.password === form.confirmPassword;

  return (
    <div className="p-4 md:p-6 space-y-6">
      <PageHeader
        eyebrow="Runly Identity"
        title="Invitar usuario"
        actions={
          <Button variant="outline" onClick={() => navigate("/app/m/runly.identity/identity/users")}>
            <ArrowLeft className="h-4 w-4" />
            Volver a usuarios
          </Button>
        }
      />

      {!canManageUsers && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm text-[hsl(var(--muted-foreground))]">
              Sin permisos para crear usuarios.
            </p>
          </CardContent>
        </Card>
      )}

      {invitationUrl && <Card><CardContent className="space-y-3 pt-6">
        <p>Comparte este enlace con la persona invitada. Debe iniciar sesión con el correo indicado y aceptar para obtener acceso. La contraseña inicial solo se aplica a cuentas nuevas.</p>
        <TextField label="Enlace de invitación" value={invitationUrl} readOnly />
        <Button onClick={() => navigator.clipboard.writeText(invitationUrl).then(() => toast.success('Enlace copiado')).catch(() => toast.error('Selecciona y copia el enlace'))}>Copiar enlace</Button>
      </CardContent></Card>}

      {canManageUsers && (
        <Card variant="shell-flat">
          <CardHeader>
            <CardTitle>Datos del nuevo usuario</CardTitle>
          </CardHeader>
          <CardContent className="pt-0 space-y-4">
            <div className="grid md:grid-cols-2 gap-4">
              <TextField
                icon={UserRound}
                label="Nombre"
                value={form.firstName}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, firstName: e.target.value }))
                }
                placeholder="Juan"
              />
              <TextField
                icon={UserRound}
                label="Apellidos"
                value={form.lastName}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, lastName: e.target.value }))
                }
                placeholder="García López"
              />
              <TextField
                icon={Mail}
                label="Correo electrónico"
                type="email"
                value={form.email}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, email: e.target.value }))
                }
                placeholder="usuario@empresa.com"
              />
              <SelectField
                icon={Shield}
                label="Rol"
                value={form.roleId}
                options={roleOptions}
                placeholder="Seleccionar rol"
                onValueChange={(value) =>
                  setForm((prev) => ({ ...prev, roleId: value }))
                }
                disabled={!canReadRoles}
              />
              <PasswordField
                icon={KeyRound}
                label="Contraseña"
                showStrength
                value={form.password}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, password: e.target.value }))
                }
                placeholder="Mínimo 8 caracteres"
              />
              <PasswordField
                icon={KeyRound}
                label="Confirmar contraseña"
                value={form.confirmPassword}
                onChange={(e) =>
                  setForm((prev) => ({ ...prev, confirmPassword: e.target.value }))
                }
                placeholder="Repite la contraseña"
                error={
                  form.confirmPassword.length > 0 && form.password !== form.confirmPassword
                    ? "Las contraseñas no coinciden"
                    : undefined
                }
              />
            </div>

            <div className="flex justify-end">
              <Button
                disabled={!isValid || createUserMutation.isPending}
                onClick={handleSubmit}
              >
                {createUserMutation.isPending
                  ? "Preparando invitación..."
                  : "Invitar usuario"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
