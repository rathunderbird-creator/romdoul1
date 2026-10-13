// The Reports-center Financials tab: the shared ledger-driven statements,
// scoped by the reports layout's global date range. The standalone pages with
// their own From / As-at pickers live under /accounting (FinancialReportsPage).
import React from 'react';
import { useOutletContext } from 'react-router-dom';
import FinancialStatements from '../accounting/FinancialStatements';

const FinancialReport: React.FC = () => {
    const { startDate, endDate } = useOutletContext<{ startDate: string; endDate: string }>();
    return <FinancialStatements startDate={startDate} endDate={endDate} />;
};

export default FinancialReport;
