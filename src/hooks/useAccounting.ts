import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { ChartOfAccount, JournalEntry, JournalEntryLine } from '../types';
import { useToast } from '../context/ToastContext';

export const useAccounting = () => {
    const { showToast } = useToast();
    const [accounts, setAccounts] = useState<ChartOfAccount[]>([]);
    const [journalEntries, setJournalEntries] = useState<JournalEntry[]>([]);
    const [isLoading, setIsLoading] = useState(false);

    const fetchAccounts = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('chart_of_accounts')
                .select('*')
                .order('account_code', { ascending: true });
                
            if (error) throw error;
            setAccounts(data || []);
        } catch (error: any) {
            console.error('Failed to fetch accounts:', error);
            showToast('Failed to fetch accounts: ' + error.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    const saveAccount = useCallback(async (account: Partial<ChartOfAccount>) => {
        try {
            const payload = {
                account_code: account.account_code,
                account_name: account.account_name,
                account_type: account.account_type,
                sub_type: account.sub_type || null,
                description: account.description,
                is_active: account.is_active ?? true
            };
            // The sub_type column arrives with migrations/add_account_subtype.sql;
            // until an instance has run it, save everything else and say so.
            const write = async (body: Record<string, unknown>) => account.id
                ? supabase.from('chart_of_accounts').update(body).eq('id', account.id)
                : supabase.from('chart_of_accounts').insert([body]);
            let { error } = await write(payload);
            if (error && /sub_type/i.test(error.message || '')) {
                const withoutSubType: Record<string, unknown> = { ...payload };
                delete withoutSubType.sub_type;
                ({ error } = await write(withoutSubType));
                if (!error) showToast('Saved without the sub-category — run migrations/add_account_subtype.sql to enable it', 'info');
            }
            if (error) throw error;
            showToast(account.id ? 'Account updated successfully' : 'Account created successfully', 'success');
            await fetchAccounts();
        } catch (error: any) {
            console.error('Failed to save account:', error);
            showToast('Failed to save account: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchAccounts]);

    const deleteAccount = useCallback(async (id: string) => {
        try {
            const { error } = await supabase.from('chart_of_accounts').delete().eq('id', id);
            if (error) throw error;
            showToast('Account deleted successfully', 'success');
            await fetchAccounts();
        } catch (error: any) {
            console.error('Failed to delete account:', error);
            showToast('Failed to delete account: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchAccounts]);

    const fetchJournalEntries = useCallback(async () => {
        setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('journal_entries')
                .select('*, lines:journal_entry_lines(*, account:chart_of_accounts(*))')
                .order('date', { ascending: false });
                
            if (error) throw error;
            setJournalEntries(data || []);
        } catch (error: any) {
            console.error('Failed to fetch journal entries:', error);
            showToast('Failed to fetch journal entries: ' + error.message, 'error');
        } finally {
            setIsLoading(false);
        }
    }, [showToast]);

    const saveJournalEntry = useCallback(async (entry: Partial<JournalEntry>, lines: Partial<JournalEntryLine>[]) => {
        try {
            // Very simple transaction equivalent (Supabase JS doesn't do real multi-table transactions easily without an RPC,
            // so we do two inserts. For production ERP, you'd write a PostgreSQL RPC for atomic inserts).
            const entryPayload: Record<string, unknown> = {
                date: entry.date,
                description: entry.description,
                reference_id: entry.reference_id,
                status: entry.status || 'Posted'
            };
            // entry_number (caller-computed — see src/utils/journalEntryNumber.ts)
            // is purely additive; omit it entirely when the caller has none.
            if (entry.entry_number) entryPayload.entry_number = entry.entry_number;
            // entry_number and status each arrive with their own migration
            // (add_journal_entry_number.sql / add_entry_status.sql). An instance
            // may have run neither, either, or both — retry dropping only the
            // column(s) the error actually names, so one missing column never
            // drops the other, still-valid one.
            const attemptPayload: Record<string, unknown> = { ...entryPayload };
            let insertedEntry: JournalEntry | null | undefined;
            let entryError: { message?: string } | null | undefined;
            for (let attempt = 0; attempt < 3; attempt++) {
                ({ data: insertedEntry, error: entryError } = await supabase
                    .from('journal_entries')
                    .insert([attemptPayload])
                    .select()
                    .single());
                if (!entryError) break;
                const msg = entryError.message || '';
                let stripped = false;
                if (/entry_number/i.test(msg) && 'entry_number' in attemptPayload) { delete attemptPayload.entry_number; stripped = true; }
                if (/status/i.test(msg) && 'status' in attemptPayload) { delete attemptPayload.status; stripped = true; }
                if (!stripped) break;
            }
            if (!entryError && !('status' in attemptPayload) && entryPayload.status !== undefined) {
                showToast('Saved as Posted — run migrations/add_entry_status.sql to enable drafts', 'info');
            }

            if (entryError || !insertedEntry) throw entryError || new Error('Failed to create journal entry');

            const linesToInsert = lines.map(line => ({
                journal_entry_id: insertedEntry.id,
                account_id: line.account_id,
                debit: line.debit || 0,
                credit: line.credit || 0
            }));

            const { error: linesError } = await supabase
                .from('journal_entry_lines')
                .insert(linesToInsert);

            if (linesError) {
                // Manual rollback if lines fail (again, RPC is better for real transactions)
                await supabase.from('journal_entries').delete().eq('id', insertedEntry.id);
                throw linesError;
            }

            showToast('Journal entry created successfully', 'success');
            await fetchJournalEntries();
        } catch (error: any) {
            console.error('Failed to save journal entry:', error);
            showToast('Failed to save journal entry: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchJournalEntries]);

    return {
        accounts,
        journalEntries,
        isLoading,
        fetchAccounts,
        saveAccount,
        deleteAccount,
        fetchJournalEntries,
        saveJournalEntry
    };
};
