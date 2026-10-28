"""Non-assignable operations; debt entry is assignable under the updated D-17."""

OWNER_ONLY_PERMISSIONS = frozenset({
    "employees.hire_employee",
    "employees.fire_employee",
    "employees.change_employee_permissions",
    "sales.correct_debt_payment",
})
