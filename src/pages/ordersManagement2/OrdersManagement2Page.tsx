// Orders Management 2 — route container. Resolves store/auth/router
// concerns and hands plain data + callbacks to the pure OM2View, following
// the same split Dashboard 2 uses (page container vs. pure view + fixtures).
import React, { useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useStore } from '../../context/StoreContext';
import { useHeader } from '../../context/HeaderContext';
import { useLanguage } from '../../context/LanguageContext';
import { useMobile } from '../../hooks/useMobile';
import { useToast } from '../../context/ToastContext';
import { useActivityLog } from '../../context/ActivityLogContext';
import { useUrlFilters, UndoToast, type UndoToastHandle } from './ui2';
import { useOrdersM2Data } from './useOrdersM2Data';
import { exportOrdersXlsx } from './exportOrders';
import { useLocalStorageState } from '../dashboard2/ui';
import OM2View from './OrdersManagement2View';
import type { OM2Actions, OrderEdit } from './types';

const DEFAULT_VISIBLE_COLUMNS = ['customer', 'product', 'total', 'owed', 'status', 'payStatus', 'courier', 'time', 'actions'];
const COLUMN_LABELS: Record<string, string> = {
    customer: 'Customer', product: 'Product', total: 'Total', owed: 'Owed', status: 'Order status',
    payStatus: 'Payment', courier: 'Courier / tracking', time: 'Time', actions: 'Actions',
    address: 'Address', page: 'Page', customerCare: 'Customer care', payBy: 'Pay by',
    received: 'Received', settledDate: 'Settled date', lastEditBy: 'Last edited by', remark: 'Remark',
    salesman: 'Salesman',
};

const OrdersManagement2Page: React.FC = () => {
    const { updateOrderStatus, updateOrder, updateOrders, currentUser, salesmen, shippingCompanies, pages, customerCare, paymentMethods, hasPermission } = useStore();
    const { setHeaderContent } = useHeader();
    const { t } = useLanguage();
    const isMobile = useMobile();
    const navigate = useNavigate();
    const { showToast } = useToast();
    const { logActivity } = useActivityLog();
    const [filters, setFilters] = useUrlFilters();
    const data = useOrdersM2Data(filters);
    const [visibleColumns, setVisibleColumns] = useLocalStorageState('om2_visible_columns', DEFAULT_VISIBLE_COLUMNS);
    const toastHandle = useRef<UndoToastHandle | null>(null);
    // A 'Mark shipped' run is in progress (see onBulkMarkShipped).
    const markingShippedRef = useRef(false);

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px' }}>Orders Management 2</h1>
                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '12px' }}>Frozen columns, a real detail drawer, batch tracking entry</p>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const applyEdit = async (edit: OrderEdit) => {
        const updates: Record<string, unknown> = {};
        if (edit.paymentStatus !== undefined) updates.paymentStatus = edit.paymentStatus;
        if (edit.expectedPaymentStatus !== undefined) updates.expectedPaymentStatus = edit.expectedPaymentStatus;
        if (edit.amountReceived !== undefined) updates.amountReceived = edit.amountReceived;
        if (edit.paymentMethod !== undefined) updates.paymentMethod = edit.paymentMethod;
        if (edit.settleDate !== undefined) updates.settleDate = edit.settleDate ? new Date(edit.settleDate).toISOString() : null;
        if (edit.depositAmount !== undefined) updates.depositAmount = edit.depositAmount;
        if (edit.depositDate !== undefined) updates.depositDate = edit.depositDate;
        if (edit.depositMethod !== undefined) updates.depositMethod = edit.depositMethod;
        if (edit.postToLedger !== undefined) updates.postToLedger = edit.postToLedger;
        if (edit.salesman !== undefined) updates.salesman = edit.salesman;
        if (edit.customerCare !== undefined) updates.customerCare = edit.customerCare;
        if (edit.remark !== undefined) updates.remark = edit.remark;
        if (edit.pageSource !== undefined) updates.pageSource = edit.pageSource;
        if (edit.address !== undefined) {
            const order = data.orders.find(o => o.id === edit.orderId) || data.rangeOrders.find(o => o.id === edit.orderId);
            updates.customer = { ...order?.customer, address: edit.address };
        }
        // Any of these three go through updateOrderStatus (it owns the
        // transition rules, stock deduction, and activity logging for
        // status/tracking changes) — orderStatus is the EXPLICIT target
        // when the drawer changed it, falling back to the order's current
        // status when only tracking/courier changed.
        if (edit.orderStatus !== undefined || edit.trackingNumber !== undefined || edit.shippingCompany !== undefined) {
            const order = data.orders.find(o => o.id === edit.orderId) || data.rangeOrders.find(o => o.id === edit.orderId);
            const targetStatus = edit.orderStatus ?? (order?.shipping?.status || 'Confirmed');
            // shownStatus: the drawer always sends its status; when that is just the
            // status it showed and the order moved on since, the real one is kept.
            // false: refused (e.g. ReStock on an order that isn't Returned) or someone
            // else changed the order first, and nothing of this call was written (its
            // tracking number included); the user has been told. Stop there: no
            // payment or detail write on top, and no "updated" toast or Undo, which
            // would push the other person's status back.
            if (!(await updateOrderStatus(edit.orderId, targetStatus as any, edit.trackingNumber, edit.shippingCompany, {
                shownStatus: edit.expectedShippingStatus ?? (edit.orderStatus === undefined ? order?.shipping?.status : undefined),
            }))) return false;
        }
        if (Object.keys(updates).length > 0 && !(await updateOrder(edit.orderId, updates as any))) return false;
        await logActivity('order_update', `Updated order ${edit.orderId}`, currentUser?.id, currentUser?.name, { edit });
        return true;
    };

    const actions = useMemo<OM2Actions>(() => ({
        onFiltersChange: setFilters,
        onRefresh: data.refresh,
        onNewOrder: () => navigate('/orders', { state: { createNew: true } }),
        // Everything the filters match (the summary strip's set), not just
        // the visible page — that is what "export this view" means.
        onExport: async () => {
            if (data.rangeOrders.length === 0) { showToast('Nothing to export for these filters.', 'error'); return; }
            try {
                await exportOrdersXlsx(data.rangeOrders, 'Filtered');
                showToast(`Exported ${data.rangeOrders.length} order(s).`, 'success');
            } catch (e) {
                console.error('Export failed', e);
                showToast('Export failed. Check console for details.', 'error');
            }
        },
        onSaveEdit: async (edit) => {
            const previous = data.orders.find(o => o.id === edit.orderId) || data.rangeOrders.find(o => o.id === edit.orderId);
            const previousEdit: OrderEdit = {
                orderId: edit.orderId,
                paymentStatus: previous?.paymentStatus,
                amountReceived: previous?.amountReceived,
                paymentMethod: edit.paymentMethod !== undefined ? previous?.paymentMethod : undefined,
                settleDate: edit.settleDate !== undefined ? (previous?.settleDate ?? null) : undefined,
                orderStatus: edit.orderStatus !== undefined ? previous?.shipping?.status : undefined,
                // Undo moves the status back only if it is still the one this edit set.
                expectedShippingStatus: edit.orderStatus !== undefined ? edit.orderStatus : undefined,
                trackingNumber: previous?.shipping?.trackingNumber,
                shippingCompany: previous?.shipping?.company,
                address: edit.address !== undefined ? previous?.customer?.address : undefined,
                pageSource: edit.pageSource !== undefined ? previous?.pageSource : undefined,
                salesman: edit.salesman !== undefined ? previous?.salesman : undefined,
                customerCare: edit.customerCare !== undefined ? previous?.customerCare : undefined,
                remark: edit.remark !== undefined ? previous?.remark : undefined,
            };
            const saved = await applyEdit(edit).catch((e: unknown) => {
                console.error('Order edit failed:', e);
                return false;
            });
            data.refresh();
            if (!saved) return false;
            toastHandle.current?.show('Order updated.', () => {
                applyEdit(previousEdit).catch((e: unknown) => { console.error('Undo failed:', e); return false; }).then(ok => {
                    if (!ok) showToast('The undo was not saved.', 'error');
                    data.refresh();
                });
            });
            return true;
        },
        onUndoEdit: async (edit) => {
            const ok = await applyEdit(edit).catch((e: unknown) => { console.error('Undo failed:', e); return false; });
            if (!ok) showToast('The undo was not saved.', 'error');
            data.refresh();
        },
        onBulkAddTracking: async (updates) => {
            let saved = 0;
            let lastReason = '';
            for (const u of updates) {
                const order = data.orders.find(o => o.id === u.orderId);
                // Tracking only: the status is the one this page showed, so if the order
                // moved on since, updateOrderStatus keeps the real one (shownStatus).
                const shown = order?.shipping?.status || 'Shipped';
                if (await updateOrderStatus(u.orderId, shown as any, u.trackingNumber, order?.shipping?.company, { shownStatus: shown, onRefused: m => { lastReason = m; } })) saved++;
            }
            await logActivity('bulk_tracking', `Added tracking IDs to ${saved} order(s)`, currentUser?.id, currentUser?.name, { count: saved });
            data.refresh();
            if (saved < updates.length) showToast(`Tracking IDs saved for ${saved} order(s); ${updates.length - saved} could not be saved: ${lastReason}`, 'error');
            else showToast(`Tracking IDs saved for ${saved} order(s).`, 'success');
        },
        onBulkMarkShipped: async (orderIds) => {
            // One run at a time: a second click while the first is still going sent
            // the same orders through again (the view also disables the button).
            if (markingShippedRef.current) return;
            markingShippedRef.current = true;
            try {
                // Each order on its own: one that is refused (already shipped from a
                // first click, changed elsewhere) or fails no longer stops the rest,
                // and the toast says what happened.
                let shipped = 0;
                let lastReason = '';
                for (const id of orderIds) {
                    // shownStatus: refused if the order is no longer at the status this page showed.
                    const shown = (data.orders.find(o => o.id === id) || data.rangeOrders.find(o => o.id === id))?.shipping?.status;
                    if (await updateOrderStatus(id, 'Shipped', undefined, undefined, { shownStatus: shown || 'Pending', onRefused: m => { lastReason = m; } })) shipped++;
                }
                const notShipped = orderIds.length - shipped;
                await logActivity('bulk_ship', `Marked ${shipped} order(s) Shipped`, currentUser?.id, currentUser?.name, { count: shipped });
                data.refresh();
                if (notShipped > 0) showToast(`${shipped} order(s) marked Shipped; ${notShipped} could not be: ${lastReason}`, 'error');
                else showToast(`${shipped} order(s) marked Shipped.`, 'success');
            } finally {
                markingShippedRef.current = false;
            }
        },
        onBulkPrint: () => showToast('Printing runs from the classic Orders page for now.', 'info'),
        onBulkExport: async (orderIds) => {
            const selected = data.orders.filter(o => orderIds.includes(o.id));
            if (selected.length === 0) { showToast('No orders selected to export.', 'error'); return; }
            try {
                await exportOrdersXlsx(selected, 'Selected');
                showToast(`Exported ${selected.length} order(s).`, 'success');
            } catch (e) {
                console.error('Export failed', e);
                showToast('Export failed. Check console for details.', 'error');
            }
        },
        // Mirrors classic Orders.tsx's handleBulkEdit (../Orders.tsx ~L1768)
        // verbatim — same fields, same per-branch update shape — since
        // BulkEditModal (../../components) is reused as-is here too.
        onBulkEdit: async (orderIds, field, value, settleDate, payBy) => {
            // Orders whose change was refused or failed (already explained, or the
            // reason kept in lastReason): reported instead of a blanket success.
            let notSaved = 0;
            let lastReason = '';
            if (field === 'date') {
                await updateOrders(orderIds, { date: new Date(value).toISOString() });
            } else if (field === 'status') {
                // Sequential, through updateOrderStatus — same reasoning as
                // classic: shares the single-row transition rules and stock
                // handling, and avoids racing shared-product stock updates.
                for (const id of orderIds) {
                    const order = data.orders.find(o => o.id === id) || data.rangeOrders.find(o => o.id === id);
                    if (order?.shipping?.status === value) continue;
                    // shownStatus: refused if the order is no longer at the status this page showed.
                    const moved = await updateOrderStatus(id, value as any, undefined, undefined, {
                        shownStatus: order?.shipping?.status || 'Pending',
                        onRefused: m => { lastReason = m; },
                    });
                    if (!moved) notSaved++;
                }
            } else if (field === 'settleDate') {
                await updateOrders(orderIds, { settleDate: value ? new Date(value).toISOString() : null as any });
            } else if (field === 'paymentStatus') {
                const now = new Date().toISOString();
                const saveOne = (id: string) => {
                    const order = data.orders.find(o => o.id === id) || data.rangeOrders.find(o => o.id === id);
                    if (!order) return Promise.resolve(true);
                    const individualUpdates: Record<string, unknown> = { paymentStatus: value };
                    if (value === 'Paid' || value === 'Settled') {
                        individualUpdates.amountReceived = order.total;
                        individualUpdates.settleDate = settleDate ? new Date(settleDate).toISOString() : now;
                        if (payBy) individualUpdates.paymentMethod = payBy;
                        // Bulk settles book their receipts too (the same flag
                        // classic Orders' bulk edit passes) — without it the
                        // orders were marked Paid with no ledger entry (OM2-2).
                        individualUpdates.postToLedger = true;
                    } else if (value === 'Get File') {
                        individualUpdates.amountReceived = order.depositAmount || 0;
                        individualUpdates.settleDate = null;
                    } else if (value === 'Cancel' || value === 'Unpaid') {
                        individualUpdates.amountReceived = 0;
                        individualUpdates.settleDate = null;
                    }
                    individualUpdates.expectedPaymentStatus = order.paymentStatus;
                    return updateOrder(id, individualUpdates as any);
                };
                // Get File moves stock (an unshipped order is counted out as Delivered), and
                // stock is read-modify-write per product, so those saves go one at a time:
                // in parallel, two orders with the same product would overwrite each other.
                // false: not saved (updateOrder has said why).
                const results: boolean[] = [];
                if (value === 'Get File') { for (const id of orderIds) results.push(await saveOne(id)); } else { results.push(...await Promise.all(orderIds.map(saveOne))); }
                notSaved = results.filter(ok => !ok).length;
            }
            const savedCount = orderIds.length - notSaved;
            await logActivity('bulk_edit', `Bulk edited ${savedCount} order(s): ${field}`, currentUser?.id, currentUser?.name, { count: savedCount, field, value });
            data.refresh();
            if (notSaved > 0) showToast(`Updated ${savedCount} of ${orderIds.length} order(s); ${notSaved} not saved${lastReason ? ': ' + lastReason : ''}`, 'error');
            else showToast(`Updated ${orderIds.length} order(s).`, 'success');
        },
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }), [setFilters, data, navigate, showToast, updateOrder, updateOrders, updateOrderStatus, logActivity, currentUser]);

    if (!hasPermission('manage_orders') && !hasPermission('create_orders') && !hasPermission('view_orders')) {
        return <div style={{ padding: '40px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>You do not have permission to view Orders Management.</div>;
    }

    return (
        <>
            <OM2View
                filters={filters}
                data={{ orders: data.orders, totalCount: data.totalCount, rangeOrders: data.rangeOrders, products: [], now: new Date() }}
                loading={data.loading}
                refreshing={data.refreshing}
                salesError={data.error ? { message: data.error, retry: data.refresh } : null}
                actions={actions}
                t={t}
                isMobile={isMobile}
                salesmen={salesmen}
                shippingCompanies={shippingCompanies}
                pageSources={pages}
                customerCare={customerCare}
                paymentMethods={paymentMethods}
                columnLabels={COLUMN_LABELS}
                visibleColumns={visibleColumns}
                onVisibleColumnsChange={setVisibleColumns}
            />
            <UndoToast handleRef={toastHandle} />
        </>
    );
};

export default OrdersManagement2Page;
