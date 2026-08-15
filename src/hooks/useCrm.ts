import { useState, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import type { Lead, Interaction, Quotation } from '../types';
import { useToast } from '../context/ToastContext';

// CRM data access — same shape as useProcurement / useWholesale.
export const useCrm = () => {
    const { showToast } = useToast();
    const [leads, setLeads] = useState<Lead[]>([]);
    const [interactions, setInteractions] = useState<Interaction[]>([]);
    const [quotations, setQuotations] = useState<Quotation[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [tableMissing, setTableMissing] = useState(false);

    // --- Leads ---
    const fetchLeads = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase.from('leads').select('*').order('created_at', { ascending: false });
            if (error) { setTableMissing(true); setLeads([]); }
            else { setTableMissing(false); setLeads((data || []) as Lead[]); }
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, []);

    const saveLead = useCallback(async (lead: Partial<Lead>) => {
        try {
            const payload = {
                name: lead.name,
                company_name: lead.company_name || null,
                email: lead.email || null,
                phone: lead.phone || null,
                status: lead.status || 'New',
                source: lead.source || null,
                assigned_to: lead.assigned_to || null,
                notes: lead.notes || null
            };
            if (lead.id) {
                const { error } = await supabase.from('leads').update(payload).eq('id', lead.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('leads').insert([payload]);
                if (error) throw error;
            }
            showToast(lead.id ? 'Lead updated' : 'Lead added', 'success');
            await fetchLeads(true);
        } catch (error: any) {
            showToast('Failed to save lead: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchLeads]);

    const deleteLead = useCallback(async (id: string) => {
        try {
            const { error } = await supabase.from('leads').delete().eq('id', id);
            if (error) throw error;
            showToast('Lead deleted', 'success');
            await fetchLeads(true);
        } catch (error: any) {
            showToast('Failed to delete lead: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchLeads]);

    // --- Interactions ---
    const fetchInteractions = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('interactions')
                .select('*, lead:leads(*)')
                .order('date', { ascending: false });
            if (error) { setTableMissing(true); setInteractions([]); }
            else { setTableMissing(false); setInteractions((data || []) as Interaction[]); }
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, []);

    const saveInteraction = useCallback(async (it: Partial<Interaction>) => {
        try {
            const payload = {
                lead_id: it.lead_id || null,
                type: it.type || 'Call',
                date: it.date || new Date().toISOString(),
                notes: it.notes || null,
                performed_by: it.performed_by || null
            };
            if (it.id) {
                const { error } = await supabase.from('interactions').update(payload).eq('id', it.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('interactions').insert([payload]);
                if (error) throw error;
            }
            showToast(it.id ? 'Interaction updated' : 'Interaction logged', 'success');
            await fetchInteractions(true);
        } catch (error: any) {
            showToast('Failed to save interaction: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchInteractions]);

    const deleteInteraction = useCallback(async (id: string) => {
        try {
            const { error } = await supabase.from('interactions').delete().eq('id', id);
            if (error) throw error;
            showToast('Interaction deleted', 'success');
            await fetchInteractions(true);
        } catch (error: any) {
            showToast('Failed to delete interaction: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchInteractions]);

    // --- Quotations ---
    const fetchQuotations = useCallback(async (silent = false) => {
        if (!silent) setIsLoading(true);
        try {
            const { data, error } = await supabase
                .from('quotations')
                .select('*, lead:leads(*)')
                .order('created_at', { ascending: false });
            if (error) { setTableMissing(true); setQuotations([]); }
            else { setTableMissing(false); setQuotations((data || []) as Quotation[]); }
        } finally {
            if (!silent) setIsLoading(false);
        }
    }, []);

    const saveQuotation = useCallback(async (q: Partial<Quotation>) => {
        try {
            const items = q.items || [];
            const payload = {
                lead_id: q.lead_id || null,
                total_amount: items.reduce((s, i) => s + (i.quantity || 0) * (i.unit_price || 0), 0),
                status: q.status || 'Draft',
                valid_until: q.valid_until || null,
                items
            };
            if (q.id) {
                const { error } = await supabase.from('quotations').update(payload).eq('id', q.id);
                if (error) throw error;
            } else {
                const { error } = await supabase.from('quotations').insert([payload]);
                if (error) throw error;
            }
            showToast(q.id ? 'Quotation updated' : 'Quotation created', 'success');
            await fetchQuotations(true);
        } catch (error: any) {
            showToast('Failed to save quotation: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchQuotations]);

    const updateQuotationStatus = useCallback(async (id: string, status: Quotation['status']) => {
        try {
            const { error } = await supabase.from('quotations').update({ status }).eq('id', id);
            if (error) throw error;
            showToast(`Quotation marked ${status}`, 'success');
            await fetchQuotations(true);
        } catch (error: any) {
            showToast('Failed to update quotation: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchQuotations]);

    const deleteQuotation = useCallback(async (id: string) => {
        try {
            const { error } = await supabase.from('quotations').delete().eq('id', id);
            if (error) throw error;
            showToast('Quotation deleted', 'success');
            await fetchQuotations(true);
        } catch (error: any) {
            showToast('Failed to delete quotation: ' + error.message, 'error');
            throw error;
        }
    }, [showToast, fetchQuotations]);

    return {
        leads, interactions, quotations, isLoading, tableMissing,
        fetchLeads, saveLead, deleteLead,
        fetchInteractions, saveInteraction, deleteInteraction,
        fetchQuotations, saveQuotation, updateQuotationStatus, deleteQuotation
    };
};
