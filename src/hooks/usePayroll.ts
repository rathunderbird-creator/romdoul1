import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { StaffAttendance } from '../types';

export const usePayroll = () => {
    const [attendances, setAttendances] = useState<StaffAttendance[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchAttendanceForPeriod = useCallback(async (startDate: string, endDate: string) => {
        setIsLoading(true);
        setError(null);
        try {
            const { data: attData, error: attError } = await supabase
                .from('staff_attendance')
                .select('*')
                .gte('date', startDate)
                .lte('date', endDate);

            if (attError) throw attError;

            const mappedAttendances = attData.map((a: any) => ({
                id: a.id,
                userId: a.user_id,
                date: a.date,
                status: a.status,
                clockIn: a.clock_in,
                clockOut: a.clock_out,
                notes: a.notes,
            })) as StaffAttendance[];

            setAttendances(mappedAttendances);
        } catch (err: any) {
            console.error('Error fetching attendance for payroll:', err);
            setError(err.message || 'Failed to fetch attendance');
        } finally {
            setIsLoading(false);
        }
    }, []);

    return {
        attendances,
        isLoading,
        error,
        fetchAttendanceForPeriod
    };
};
