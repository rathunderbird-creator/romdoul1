import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { User, StaffAttendance } from '../types';

export const useAttendance = () => {
    const [attendances, setAttendances] = useState<StaffAttendance[]>([]);
    const [staff, setStaff] = useState<User[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const fetchAttendanceData = useCallback(async (date: string) => {
        setIsLoading(true);
        setError(null);
        try {
            // First select all staff (users)
            // Wait, we can get active users where role is not something we want to ignore, but let's just get all users for now.
            const { data: usersData, error: usersError } = await supabase
                .from('users')
                .select('*')
                .order('name', { ascending: true });

            if (usersError) throw usersError;

            const mappedStaff = usersData.map((u: any) => ({
                id: u.id,
                name: u.name,
                email: u.email,
                roleId: u.role_id,
                pin: u.pin
            })) as User[];
            
            setStaff(mappedStaff);

            // Select attendance records for the given date
            const { data: attData, error: attError } = await supabase
                .from('staff_attendance')
                .select('*')
                .eq('date', date);

            if (attError) throw attError;

            // Map database keys to camelCase
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
            console.error('Error fetching attendance:', err);
            setError(err.message || 'Failed to fetch attendance');
        } finally {
            setIsLoading(false);
        }
    }, []);

    const updateAttendance = async (
        userId: string,
        date: string,
        updates: Partial<Omit<StaffAttendance, 'id' | 'userId' | 'date'>>
    ) => {
        // Capture previous state for rollback
        let previousState: StaffAttendance[] = [];
        setAttendances(prev => {
            previousState = prev;
            return prev;
        });

        // Optimistic UI Update
        setAttendances(prev => {
            const existingIndex = prev.findIndex(a => a.userId === userId && a.date === date);
            if (existingIndex >= 0) {
                const newArr = [...prev];
                newArr[existingIndex] = { ...newArr[existingIndex], ...updates };
                return newArr;
            } else {
                return [...prev, {
                    id: `temp-${Date.now()}`,
                    userId,
                    date,
                    status: 'Present',
                    clockIn: null,
                    clockOut: null,
                    notes: null,
                    ...updates
                } as unknown as StaffAttendance];
            }
        });

        try {
            // Check if record exists
            let existing = previousState.find(a => a.userId === userId && a.date === date);

            // Transform update keys to snake_case for DB
            const dbUpdates: any = {};
            if (updates.status !== undefined) dbUpdates.status = updates.status;
            if (updates.clockIn !== undefined) dbUpdates.clock_in = updates.clockIn || null;
            if (updates.clockOut !== undefined) dbUpdates.clock_out = updates.clockOut || null;
            if (updates.notes !== undefined) dbUpdates.notes = updates.notes;

            let newOrUpdatedRecord: any = null;

            if (!existing) {
                // Check DB directly to prevent race conditions
                const { data: dbCheck } = await supabase
                    .from('staff_attendance')
                    .select('id')
                    .eq('user_id', userId)
                    .eq('date', date)
                    .maybeSingle();
                if (dbCheck) {
                    existing = dbCheck as any;
                }
            }

            if (existing) {
                // Update
                const { data, error: updateErr } = await supabase
                    .from('staff_attendance')
                    .update(dbUpdates)
                    .eq('id', existing.id)
                    .select()
                    .single();

                if (updateErr) throw updateErr;
                newOrUpdatedRecord = data;
            } else {
                // Insert
                const { data, error: insertErr } = await supabase
                    .from('staff_attendance')
                    .insert({
                        user_id: userId,
                        date: date,
                        ...dbUpdates
                    })
                    .select()
                    .single();

                if (insertErr) throw insertErr;
                newOrUpdatedRecord = data;
            }

            // Update local state with the exact record from DB
            const mappedRecord: StaffAttendance = {
                id: newOrUpdatedRecord.id,
                userId: newOrUpdatedRecord.user_id,
                date: newOrUpdatedRecord.date,
                status: newOrUpdatedRecord.status,
                clockIn: newOrUpdatedRecord.clock_in,
                clockOut: newOrUpdatedRecord.clock_out,
                notes: newOrUpdatedRecord.notes
            };

            setAttendances(prev => {
                // Replace either the temp record or the old record with the real one
                return prev.map(a => 
                    (a.userId === mappedRecord.userId && a.date === mappedRecord.date) 
                        ? mappedRecord 
                        : a
                );
            });

            return newOrUpdatedRecord;
        } catch (err: any) {
            console.error('Error saving attendance:', err);
            // Revert optimistic update
            setAttendances(previousState);
            setError(`Database Error: ${err.message || 'Failed to save attendance'}. Please ensure 'staff_attendance.sql' was run in your Supabase SQL Editor.`);
            throw err;
        }
    };

    return {
        staff,
        attendances,
        isLoading,
        error,
        fetchAttendanceData,
        updateAttendance
    };
};
