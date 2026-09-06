import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Employee, LeaveRequest, PayrollRun } from '../types';
import { useToast } from '../context/ToastContext';

const generateUUID = () => {
    if (typeof window !== 'undefined' && window.crypto && window.crypto.randomUUID) {
        return window.crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        const r = Math.random() * 16 | 0, v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
};

// Rows fetched with a joined `employee` object (leave requests, payroll runs)
// were being sent straight back on update — PostgREST rejects the unknown
// `employee` column, which silently broke Edit, Approve/Reject, and Pay.
// Only real table columns leave the client, and cleared DATE inputs go out as
// NULL ('' is rejected by Postgres for date columns).
const EMPLOYEE_COLUMNS = ['first_name', 'last_name', 'email', 'phone', 'department', 'position', 'hire_date', 'base_salary', 'status'] as const;
const LEAVE_COLUMNS = ['employee_id', 'leave_type', 'start_date', 'end_date', 'status', 'reason'] as const;
const PAYROLL_COLUMNS = ['employee_id', 'month', 'base_pay', 'bonus', 'deductions', 'net_pay', 'payment_status', 'payment_date'] as const;
const DATE_COLUMNS = new Set(['hire_date', 'payment_date', 'start_date', 'end_date']);
const pick = (obj: Record<string, any>, cols: readonly string[]) => {
    const out: Record<string, any> = {};
    for (const c of cols) {
        if (obj[c] === undefined) continue;
        out[c] = DATE_COLUMNS.has(c) && obj[c] === '' ? null : obj[c];
    }
    return out;
};

// Staff who can receive payslips and leave requests: everyone not Terminated
// (someone On Leave is exactly who the Leaves page is for, and paid leave
// months still need a payslip).
export const isPayableEmployee = (e: Employee) => e.status !== 'Terminated';

// Salary payments are booked in Income & Expense under this category, tagged
// with the payroll run id so status reverts and deletes can find the row.
export const SALARY_EXPENSE_CATEGORY = 'ប្រាក់ខែ';
const payrollMarker = (runId: string) => `#PAY-${String(runId).slice(0, 8)}`;

export const useHR = () => {
    const { showToast } = useToast();
    const [employees, setEmployees] = useState<Employee[]>([]);
    const [leaveRequests, setLeaveRequests] = useState<LeaveRequest[]>([]);
    const [payrollRuns, setPayrollRuns] = useState<PayrollRun[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    // --- Employees ---
    const fetchEmployees = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('employees')
                .select('*')
                .order('first_name', { ascending: true });

            if (error) throw error;
            setEmployees(data || []);
        } catch (error: any) {
            console.error('Failed to fetch employees:', error);
            showToast('Failed to fetch employees: ' + error.message, 'error');
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [showToast]);

    const saveEmployee = useCallback(async (employee: Partial<Employee>) => {
        try {
            const payload = pick(employee, EMPLOYEE_COLUMNS);
            // Email is UNIQUE: store it trimmed, and an empty one as NULL so two
            // blank emails can't collide.
            if (payload.email !== undefined) {
                const trimmed = String(payload.email || '').trim();
                payload.email = trimmed ? trimmed : null;
            }
            if (payload.phone !== undefined) payload.phone = String(payload.phone || '').trim() || null;
            if (employee.id) {
                const { error } = await supabase
                    .from('employees')
                    .update(payload)
                    .eq('id', employee.id);
                if (error) throw error;
                showToast('Employee updated successfully', 'success');
            } else {
                const { error } = await supabase
                    .from('employees')
                    .insert([payload]);
                if (error) throw error;
                showToast('Employee created successfully', 'success');
            }
            await fetchEmployees(true);
        } catch (error: any) {
            console.error('Failed to save employee:', error);
            showToast('Failed to save employee: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchEmployees]);

    const deleteEmployee = useCallback(async (id: string) => {
        try {
            // payroll_runs cascade away with the employee — capture the paid
            // runs FIRST so their salary Expense rows can be cleaned afterwards
            // (same order as deletePurchaseOrder: never a live record whose
            // books already vanished).
            const { data: paidRuns, error: runsErr } = await supabase
                .from('payroll_runs').select('id').eq('employee_id', id).eq('payment_status', 'Paid');
            if (runsErr) throw runsErr;
            const { error } = await supabase.from('employees').delete().eq('id', id);
            if (error) throw error;
            for (const r of paidRuns || []) {
                const { error: txErr } = await supabase.from('transactions').delete().like('description', `%${payrollMarker(r.id)}%`);
                if (txErr) console.error('Failed to remove salary expense row for deleted employee:', txErr);
            }
            showToast('Employee deleted successfully', 'success');
            await fetchEmployees(true);
        } catch (error: any) {
            console.error('Failed to delete employee:', error);
            showToast('Failed to delete employee: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchEmployees]);

    // --- Leave Requests ---
    const fetchLeaveRequests = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('leave_requests')
                .select('*, employee:employees(*)')
                .order('start_date', { ascending: false });

            if (error) throw error;
            setLeaveRequests(data || []);
        } catch (error: any) {
            console.error('Failed to fetch leave requests:', error);
            showToast('Failed to fetch leave requests: ' + error.message, 'error');
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [showToast]);

    const saveLeaveRequest = useCallback(async (leave: Partial<LeaveRequest>) => {
        try {
            const payload = pick(leave, LEAVE_COLUMNS);
            if (leave.id) {
                const { error } = await supabase
                    .from('leave_requests')
                    .update(payload)
                    .eq('id', leave.id);
                if (error) throw error;
                showToast('Leave request updated successfully', 'success');
            } else {
                const { error } = await supabase
                    .from('leave_requests')
                    .insert([payload]);
                if (error) throw error;
                showToast('Leave request created successfully', 'success');
            }
            await fetchLeaveRequests(true);
        } catch (error: any) {
            console.error('Failed to save leave request:', error);
            showToast('Failed to save leave request: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchLeaveRequests]);

    const deleteLeaveRequest = useCallback(async (id: string) => {
        try {
            const { error } = await supabase.from('leave_requests').delete().eq('id', id);
            if (error) throw error;
            showToast('Leave request deleted successfully', 'success');
            await fetchLeaveRequests(true);
        } catch (error: any) {
            console.error('Failed to delete leave request:', error);
            showToast('Failed to delete leave request: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchLeaveRequests]);

    // --- Payroll Runs ---
    const fetchPayrollRuns = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('payroll_runs')
                .select('*, employee:employees(*)')
                .order('month', { ascending: false });

            if (error) throw error;
            setPayrollRuns(data || []);
        } catch (error: any) {
            console.error('Failed to fetch payroll runs:', error);
            showToast('Failed to fetch payroll runs: ' + error.message, 'error');
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, [showToast]);

    // Keep Income & Expense in step with a payroll run: a Paid run has exactly
    // one salary Expense row (tagged with its marker); a Pending run has none.
    // Idempotent: an existing row is updated IN PLACE (so a bookkeeper's Pay By
    // or description tweaks survive an HR edit, and a double-click can't
    // duplicate it), extras are trimmed, and nothing is written when the
    // lookup itself failed. Non-fatal — the payroll record is already saved.
    const syncSalaryExpense = useCallback(async (run: { id: string; month: string; net_pay: number; payment_status: string; payment_date?: string | null }, employeeName: string) => {
        const marker = payrollMarker(run.id);
        const { data: existingRows, error: selErr } = await supabase
            .from('transactions').select('id').like('description', `%${marker}%`);
        if (selErr) {
            console.error('Could not read salary expense rows; leaving the ledger untouched:', selErr);
            return;
        }
        const rows = existingRows || [];
        const shouldExist = run.payment_status === 'Paid' && Number(run.net_pay) > 0;

        if (!shouldExist) {
            if (rows.length > 0) {
                const { error } = await supabase.from('transactions').delete().in('id', rows.map(r => r.id));
                if (error) console.error('Failed to remove salary expense row:', error);
            }
            return;
        }

        const payDate = run.payment_date || new Date().toISOString().split('T')[0];
        const dateIso = new Date(payDate).toISOString();
        if (rows.length > 0) {
            const [keep, ...extras] = rows;
            const { error: upErr } = await supabase.from('transactions')
                .update({ amount: Number(run.net_pay), date: dateIso })
                .eq('id', keep.id);
            if (upErr) console.error('Failed to update salary expense row:', upErr);
            if (extras.length > 0) {
                const { error: exErr } = await supabase.from('transactions').delete().in('id', extras.map(r => r.id));
                if (exErr) console.error('Failed to trim duplicate salary expense rows:', exErr);
            }
            return;
        }

        const { error: insErr } = await supabase.from('transactions').insert([{
            id: generateUUID(),
            date: dateIso,
            type: 'Expense',
            category: SALARY_EXPENSE_CATEGORY,
            amount: Number(run.net_pay),
            description: `${employeeName} · ${run.month} ${marker}`,
            added_by: 'Payroll'
        }]);
        if (insErr) {
            console.error('Failed to log salary expense:', insErr);
            showToast('Payroll saved, but logging the salary to Expense failed: ' + insErr.message, 'error');
        }
    }, [showToast]);

    const employeeDisplayName = useCallback((employeeId: string, joined?: Employee) => {
        const emp = joined || employees.find(e => e.id === employeeId);
        return emp ? `${emp.first_name} ${emp.last_name}`.trim() : 'Employee';
    }, [employees]);

    const savePayrollRun = useCallback(async (payroll: Partial<PayrollRun>) => {
        try {
            const payload = pick(payroll, PAYROLL_COLUMNS);
            if (payload.payment_status !== 'Paid') payload.payment_date = null;
            let runId = payroll.id;
            if (runId) {
                const { error } = await supabase
                    .from('payroll_runs')
                    .update(payload)
                    .eq('id', runId);
                if (error) throw error;
                showToast('Payroll record updated successfully', 'success');
            } else {
                const { data: inserted, error } = await supabase
                    .from('payroll_runs')
                    .insert([payload])
                    .select('id')
                    .single();
                if (error) throw error;
                runId = inserted.id;
                showToast('Payroll record created successfully', 'success');
            }
            if (runId) {
                await syncSalaryExpense(
                    { id: runId, month: payload.month, net_pay: payload.net_pay, payment_status: payload.payment_status, payment_date: payload.payment_date },
                    employeeDisplayName(payload.employee_id, payroll.employee)
                );
            }
            await fetchPayrollRuns(true);
        } catch (error: any) {
            console.error('Failed to save payroll run:', error);
            showToast('Failed to save payroll run: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPayrollRuns, syncSalaryExpense, employeeDisplayName]);

    // One click for the whole month: a Pending payslip at base salary for every
    // payable (non-Terminated) employee who doesn't have one yet.
    const generatePayrollForMonth = useCallback(async (month: string) => {
        try {
            const { data: existing, error: exErr } = await supabase.from('payroll_runs').select('employee_id').eq('month', month);
            if (exErr) throw exErr;
            const already = new Set((existing || []).map((r: any) => r.employee_id));
            const targets = employees.filter(e => isPayableEmployee(e) && !already.has(e.id));
            if (targets.length > 0) {
                const rows = targets.map(e => ({
                    employee_id: e.id,
                    month,
                    base_pay: e.base_salary || 0,
                    bonus: 0,
                    deductions: 0,
                    net_pay: e.base_salary || 0,
                    payment_status: 'Pending'
                }));
                const { error } = await supabase.from('payroll_runs').insert(rows);
                if (error) throw error;
            }
            await fetchPayrollRuns(true);
            return { created: targets.length, skipped: already.size };
        } catch (error: any) {
            console.error('Failed to generate payroll:', error);
            showToast('Failed to generate payroll: ' + error.message, 'error');
            throw error;
        }
    }, [employees, showToast, fetchPayrollRuns]);

    const deletePayrollRun = useCallback(async (id: string) => {
        try {
            const { error } = await supabase.from('payroll_runs').delete().eq('id', id);
            if (error) throw error;
            // Its salary Expense row (if it was paid) goes with it.
            const { error: txErr } = await supabase.from('transactions').delete().like('description', `%${payrollMarker(id)}%`);
            if (txErr) console.error('Failed to remove salary expense row:', txErr);
            showToast('Payroll record deleted successfully', 'success');
            await fetchPayrollRuns(true);
        } catch (error: any) {
            console.error('Failed to delete payroll run:', error);
            showToast('Failed to delete payroll run: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPayrollRuns]);

    return {
        employees,
        leaveRequests,
        payrollRuns,
        isLoading,
        fetchEmployees,
        saveEmployee,
        deleteEmployee,
        fetchLeaveRequests,
        saveLeaveRequest,
        deleteLeaveRequest,
        fetchPayrollRuns,
        savePayrollRun,
        generatePayrollForMonth,
        deletePayrollRun
    };
};
