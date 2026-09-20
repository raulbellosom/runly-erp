import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { RunlyForm, PageHeader, LoadingState, ErrorState, Button, ConfirmDialog } from '@runly/ui'
import { Eye, ShieldBan } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { useAuth } from '../../../auth/AuthProvider'
import { useActiveCompany } from '../../../company/ActiveCompanyProvider'
import { getApiUrl } from '../../../lib/runtimeConfig.js'
import { runly } from '../../../lib/runly'
import { HR_EMPLOYEE_FORM } from '../blueprints/hr-employee-form.blueprint.js'

const API_BASE = getApiUrl()

// Mounted by HrScreen.jsx (new-employee and edit-employee branches both
// render this with employeeId set to null / the target id — see
// HrScreen.jsx's isNewRoute/editEmployeeId handling).
export default function HrEmployeeForm({ employeeId }) {
  const isEdit = Boolean(employeeId)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [enabledConfirm, setEnabledConfirm] = useState(false)

  const { session, userProfile } = useAuth()
  const token = session?.access_token
  const { activeCompanyId } = useActiveCompany()

  const permissions = userProfile?.permissions ?? []
  const hasPermission = (k) => Boolean(userProfile?.isAdmin || permissions.includes(k))
  const canSubmit = isEdit
    ? hasPermission('hr.employee.update')
    : hasPermission('hr.employee.create')
  const canDelete = hasPermission('hr.employee.delete')

  const employeeQuery = useQuery({
    queryKey: ['hr-employee', employeeId],
    queryFn: () => runly.hr.getEmployee(employeeId, token),
    enabled: Boolean(token && isEdit && employeeId),
  })
  const editEmployee = employeeQuery.data?.data ?? null

  const toggleEnabledMutation = useMutation({
    mutationFn: (enabled) => runly.hr.setEmployeeEnabled(employeeId, enabled, token),
    onMutate: (enabled) =>
      toast.loading(enabled ? 'Habilitando colaborador...' : 'Deshabilitando colaborador...'),
    onSuccess: (_, enabled, toastId) => {
      toast.success(enabled ? 'Colaborador habilitado' : 'Colaborador deshabilitado', { id: toastId })
      queryClient.invalidateQueries({ queryKey: ['hr-employees'] })
      queryClient.invalidateQueries({ queryKey: ['hr-employee', employeeId] })
      setEnabledConfirm(false)
    },
    onError: (_, enabled, toastId) =>
      toast.error(
        enabled ? 'No se pudo habilitar el colaborador' : 'No se pudo deshabilitar el colaborador',
        { id: toastId },
      ),
  })

  if (isEdit && employeeQuery.isLoading) {
    return <LoadingState message="Cargando colaborador..." />
  }
  if (isEdit && employeeQuery.isError) {
    return <ErrorState message="No se pudo cargar el colaborador" />
  }
  if (!canSubmit) {
    return (
      <div className="p-4 md:p-6">
        <ErrorState title="No tienes permiso para esta acción" />
      </div>
    )
  }

  const fullName = editEmployee ? `${editEmployee.firstName} ${editEmployee.lastName}`.trim() : ''

  return (
    <div className="p-4 md:p-6 pb-24">
      <PageHeader
        eyebrow={isEdit ? 'Editar colaborador' : 'Recursos Humanos'}
        title={isEdit ? (fullName || 'Editar colaborador') : 'Nuevo colaborador'}
        description={isEdit ? undefined : 'Completa la información del colaborador'}
      />
      <div className="mt-6">
        <RunlyForm
          blueprint={HR_EMPLOYEE_FORM}
          initialData={isEdit ? editEmployee : {}}
          mode={isEdit ? 'edit' : 'create'}
          token={token}
          companyId={activeCompanyId}
          apiBaseUrl={API_BASE}
          asideActions={
            isEdit && editEmployee ? (
              <div className="glass-shell-flat flex flex-col gap-2 rounded-2xl p-3">
                <Button
                  type="button"
                  variant="glass"
                  className="w-full justify-start"
                  onClick={() => navigate(`/app/m/runly.hr/hr/employees/${employeeId}`)}
                >
                  <Eye className="h-4 w-4" />
                  Ver colaborador
                </Button>
                {canDelete && (
                  <Button
                    type="button"
                    variant="destructive"
                    className="w-full justify-start"
                    onClick={() => setEnabledConfirm(true)}
                  >
                    <ShieldBan className="h-4 w-4" />
                    {editEmployee.enabled === false ? 'Habilitar colaborador' : 'Deshabilitar colaborador'}
                  </Button>
                )}
              </div>
            ) : null
          }
          onSuccess={(result) => {
            const savedId = result?.data?.id ?? editEmployee?.id
            navigate(savedId ? `/app/m/runly.hr/hr/employees/${savedId}` : '/app/m/runly.hr/hr/employees')
          }}
          onCancel={() => navigate(-1)}
          // Marking a cover photo (or any upload/remove) saves immediately via
          // AttachmentsPanel, independent of the form's own save — without
          // this, the detail screen's cached ['hr-employee', id] query (5min
          // staleTime) would keep showing the old photo after navigating
          // there, even right after the change.
          onAttachmentsChange={() => {
            if (employeeId) queryClient.invalidateQueries({ queryKey: ['hr-employee', employeeId] })
          }}
        />
      </div>

      {isEdit && editEmployee ? (
        <ConfirmDialog
          open={enabledConfirm}
          onOpenChange={setEnabledConfirm}
          title={editEmployee.enabled === false ? 'Habilitar colaborador' : 'Deshabilitar colaborador'}
          description={
            editEmployee.enabled === false
              ? `¿Deseas habilitar nuevamente a ${fullName}?`
              : `¿Deseas deshabilitar a ${fullName}? No podrá acceder al sistema mientras esté deshabilitado.`
          }
          confirmLabel={editEmployee.enabled === false ? 'Habilitar' : 'Deshabilitar'}
          onConfirm={() => toggleEnabledMutation.mutate(editEmployee.enabled === false)}
          loading={toggleEnabledMutation.isPending}
        />
      ) : null}
    </div>
  )
}
