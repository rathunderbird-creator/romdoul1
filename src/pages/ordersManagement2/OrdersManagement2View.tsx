// Orders Management 2 — pure view. Top to bottom (spec §4): one-row command
// bar → filter chips → summary strip (totals + status toggles) → table
// (desktop) / card list (mobile) → row drawer → bulk action bar.
import React, { useMemo, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import './ordersManagement2.css';
import { D2 } from '../dashboard2/theme';
import { EmptyState, ErrorInline, Skeleton } from '../dashboard2/ui';
import { ReceiptModal, BulkEditModal } from '../../components';
import { statusSegments, noTrackingCount, summarizeMoney, sortOrders, isMissingTracking, type Order, type SortState } from './metrics';
import { filterChips, DEFAULT_FILTERS } from './urlFilters';
import type { OM2ViewProps, DrawerState } from './types';
import CommandBar from './components/CommandBar';
import SummaryStrip from './components/SummaryStrip';
import OrdersTable from './components/OrdersTable';
import RowDrawer from './components/RowDrawer';
import BulkActionBar from './components/BulkActionBar';
import AddTrackingModal from './components/AddTrackingModal';
import MobileOrderList2 from './components/MobileOrderList2';

const OM2View: React.FC<OM2ViewProps> = ({ filters, data, loading, refreshing, salesError, actions, t, isMobile, salesmen, shippingCompanies, pageSources, customerCare, paymentMethods, columnLabels, visibleColumns, onVisibleColumnsChange }) => {
    const { orders, rangeOrders, totalCount } = data;
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [drawer, setDrawer] = useState<DrawerState>({ order: null, isOpen: false });
    const [isTrackingModalOpen, setIsTrackingModalOpen] = useState(false);
    const [isBulkEditOpen, setIsBulkEditOpen] = useState(false);
    const [receiptOrder, setReceiptOrder] = useState<Order | null>(null);

    const totals = useMemo(() => summarizeMoney(rangeOrders), [rangeOrders]);
    const segments = useMemo(() => statusSegments(rangeOrders), [rangeOrders]);
    const noTracking = useMemo(() => noTrackingCount(rangeOrders), [rangeOrders]);
    const sortedOrders = useMemo(() => sortOrders(orders, filters.sort), [orders, filters.sort]);
    const chips = useMemo(() => filterChips(filters), [filters]);

    const selectedOrders = useMemo(() => orders.filter(o => selectedIds.has(o.id)), [orders, selectedIds]);
    const isEmpty = !loading && !salesError && totalCount === 0;

    const openDrawer = (order: (typeof orders)[number]) => setDrawer({ order, isOpen: true });
    const closeDrawer = () => setDrawer({ order: null, isOpen: false });

    const setSort = (sort: SortState | null) => actions.onFiltersChange(prev => ({ ...prev, sort, page: 1 }));

    return (
        <div className="om2" style={{ paddingBottom: isMobile ? 90 : 24 }}>
            <CommandBar
                filters={filters}
                onFiltersChange={actions.onFiltersChange}
                onRefresh={actions.onRefresh}
                onNewOrder={actions.onNewOrder}
                onExport={actions.onExport}
                refreshing={refreshing}
                salesmen={salesmen}
                shippingCompanies={shippingCompanies}
                pageSources={pageSources}
                columnLabels={columnLabels}
                visibleColumns={visibleColumns}
                onVisibleColumnsChange={onVisibleColumnsChange}
                t={t}
                isMobile={isMobile}
            />

            {chips.length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', margin: '8px 0 4px' }}>
                    {chips.map(chip => (
                        <button
                            key={chip.key}
                            type="button"
                            onClick={() => actions.onFiltersChange(chip.onRemove)}
                            className="d2-clickable"
                            style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 6px 3px 10px', borderRadius: 999, fontSize: 12, fontWeight: 600, color: D2.ink, background: '#eef1f6', border: `1px solid ${D2.border}` }}
                        >
                            {chip.label}
                            <span aria-hidden style={{ display: 'inline-flex', width: 16, height: 16, borderRadius: '50%', background: '#dfe3ea', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>×</span>
                        </button>
                    ))}
                    <button
                        type="button"
                        onClick={() => actions.onFiltersChange(prev => ({ ...DEFAULT_FILTERS, dateStart: '', dateEnd: '', pageSize: prev.pageSize }))}
                        style={{ background: 'none', border: 'none', color: D2.red, fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '4px 6px' }}
                    >
                        Clear all
                    </button>
                </div>
            )}

            {loading ? (
                <div aria-busy="true">
                    <Skeleton height={56} style={{ borderRadius: 12, marginBottom: 10 }} />
                    <Skeleton height={44} style={{ borderRadius: 10, marginBottom: 10 }} />
                    {Array.from({ length: 10 }, (_, i) => <Skeleton key={i} height={40} style={{ borderRadius: 8, marginBottom: 4 }} />)}
                </div>
            ) : salesError ? (
                <ErrorInline message={`Couldn't load orders. ${salesError.message}`} onRetry={salesError.retry} retryLabel="Retry" />
            ) : isEmpty ? (
                <EmptyState
                    icon={<ShoppingBag size={40} />}
                    title="No orders match these filters"
                    hint={filterChips(filters).length > 0 ? `Active filters: ${filterChips(filters).map(c => c.label).join(', ')}` : 'No orders yet.'}
                    actionLabel="New order"
                    onAction={actions.onNewOrder}
                />
            ) : (
                <>
                    <SummaryStrip totals={totals} segments={segments} noTracking={noTracking} filters={filters} onFiltersChange={actions.onFiltersChange} />

                    {isMobile ? (
                        <MobileOrderList2
                            orders={sortedOrders}
                            totalCount={totalCount}
                            filters={filters}
                            onFiltersChange={actions.onFiltersChange}
                            onOpenOrder={openDrawer}
                            salesmen={salesmen}
                            shippingCompanies={shippingCompanies}
                        />
                    ) : (
                        <OrdersTable
                            orders={sortedOrders}
                            totalCount={totalCount}
                            filters={filters}
                            onFiltersChange={actions.onFiltersChange}
                            visibleColumns={visibleColumns}
                            columnLabels={columnLabels}
                            selectedIds={selectedIds}
                            onSelectedIdsChange={setSelectedIds}
                            onRowClick={openDrawer}
                            onPrintOrder={setReceiptOrder}
                            sort={filters.sort}
                            onSortChange={setSort}
                            isMissingTracking={isMissingTracking}
                        />
                    )}
                </>
            )}

            <RowDrawer
                order={drawer.order}
                isOpen={drawer.isOpen}
                onClose={closeDrawer}
                onSave={actions.onSaveEdit}
                onPrint={setReceiptOrder}
                salesmen={salesmen}
                customerCare={customerCare}
                paymentMethods={paymentMethods}
            />

            {selectedOrders.length > 0 && (
                <BulkActionBar
                    selectedOrders={selectedOrders}
                    onClear={() => setSelectedIds(new Set())}
                    onAddTracking={() => setIsTrackingModalOpen(true)}
                    onMarkShipped={() => actions.onBulkMarkShipped(selectedOrders.map(o => o.id)).then(() => setSelectedIds(new Set()))}
                    onBulkEdit={() => setIsBulkEditOpen(true)}
                    onPrint={() => actions.onBulkPrint(selectedOrders.map(o => o.id))}
                    onExport={() => actions.onBulkExport(selectedOrders.map(o => o.id))}
                />
            )}

            <AddTrackingModal
                isOpen={isTrackingModalOpen}
                orders={selectedOrders}
                onClose={() => setIsTrackingModalOpen(false)}
                onSave={async (updates) => { await actions.onBulkAddTracking(updates); setIsTrackingModalOpen(false); setSelectedIds(new Set()); }}
            />

            {/* Mounted only while open — BulkEditModal calls useStore()
                unconditionally at its top (before its own isOpen check), so
                keeping it always-mounted-but-hidden would call it on every
                render of this page regardless of whether it's ever opened. */}
            {isBulkEditOpen && (
                <BulkEditModal
                    isOpen={isBulkEditOpen}
                    onClose={() => setIsBulkEditOpen(false)}
                    count={selectedOrders.length}
                    onApply={async (field, value, settleDate, payBy) => {
                        await actions.onBulkEdit(selectedOrders.map(o => o.id), field, value, settleDate, payBy);
                        setSelectedIds(new Set());
                    }}
                />
            )}

            {receiptOrder && (
                <ReceiptModal sale={receiptOrder} onClose={() => setReceiptOrder(null)} />
            )}
        </div>
    );
};

export default OM2View;
