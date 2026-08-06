import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Employee, LeaveRequest, PayrollRun } from '../types';
import { useToast } from '../context/ToastContext';

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
            if (employee.id) {
                const { error } = await supabase
                    .from('employees')
                    .update(employee)
                    .eq('id', employee.id);
                if (error) throw error;
                showToast('Employee updated successfully', 'success');
            } else {
                const { error } = await supabase
                    .from('employees')
                    .insert([employee]);
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
            const { error } = await supabase.from('employees').delete().eq('id', id);
            if (error) throw error;
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
            if (leave.id) {
                const { error } = await supabase
                    .from('leave_requests')
                    .update(leave)
                    .eq('id', leave.id);
                if (error) throw error;
                showToast('Leave request updated successfully', 'success');
            } else {
                const { error } = await supabase
                    .from('leave_requests')
                    .insert([leave]);
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

    const savePayrollRun = useCallback(async (payroll: Partial<PayrollRun>) => {
        try {
            if (payroll.id) {
                const { error } = await supabase
                    .from('payroll_runs')
                    .update(payroll)
                    .eq('id', payroll.id);
                if (error) throw error;
                showToast('Payroll record updated successfully', 'success');
            } else {
                const { error } = await supabase
                    .from('payroll_runs')
                    .insert([payroll]);
                if (error) throw error;
                showToast('Payroll record created successfully', 'success');
            }
            await fetchPayrollRuns(true);
        } catch (error: any) {
            console.error('Failed to save payroll run:', error);
            showToast('Failed to save payroll run: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchPayrollRuns]);

    const deletePayrollRun = useCallback(async (id: string) => {
        try {
            const { error } = await supabase.from('payroll_runs').delete().eq('id', id);
            if (error) throw error;
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
        deletePayrollRun
    };
};
