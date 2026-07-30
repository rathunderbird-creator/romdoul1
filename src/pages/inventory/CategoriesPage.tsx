import React, { useState, useEffect, useMemo } from 'react';
import { Tags, Plus, Trash2, Search, Tag } from 'lucide-react';
import { useStore } from '../../context/StoreContext';
import { useHeader } from '../../context/HeaderContext';
import { useToast } from '../../context/ToastContext';
import { useMobile } from '../../hooks/useMobile';

const CategoriesPage: React.FC = () => {
    const { categories, addCategory, removeCategory, products, currentUser } = useStore();
    const { setHeaderContent } = useHeader();
    const { showToast } = useToast();
    const isMobile = useMobile();

    const [searchTerm, setSearchTerm] = useState('');
    const [newCategory, setNewCategory] = useState('');

    const isAdmin = currentUser?.roleId === 'admin';

    useEffect(() => {
        setHeaderContent({
            title: (
                <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <h1 style={{ fontSize: '15px', fontWeight: 'bold', marginBottom: '2px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <Tags size={16} /> Categories
                    </h1>
                </div>
            ),
        });
        return () => setHeaderContent(null);
    }, [setHeaderContent]);

    const filteredCategories = useMemo(() => {
        return categories.filter(c => c.toLowerCase().includes(searchTerm.toLowerCase())).sort((a, b) => a.localeCompare(b));
    }, [categories, searchTerm]);

    const getProductCount = (categoryName: string) => {
        return products.filter(p => p.category === categoryName).length;
    };

    const handleAddCategory = (e: React.FormEvent) => {
        e.preventDefault();
        const trimmed = newCategory.trim();
        if (!trimmed) return;

        if (categories.includes(trimmed)) {
            showToast('Category already exists', 'error');
            return;
        }

        try {
            addCategory(trimmed);
            setNewCategory('');
            showToast('Category added', 'success');
        } catch (error) {
            showToast('Failed to add category', 'error');
        }
    };

    const handleDeleteCategory = (category: string) => {
        const count = getProductCount(category);
        if (count > 0) {
            if (!window.confirm(`There are ${count} products in the "${category}" category. Deleting it will leave those products uncategorized (or keep the string on their record but it won't show in the dropdown). Are you sure?`)) {
                return;
            }
        } else {
            if (!window.confirm(`Delete category "${category}"?`)) return;
        }

        try {
            removeCategory(category);
            showToast('Category deleted', 'success');
        } catch (error) {
            showToast('Failed to delete category', 'error');
        }
    };

    return (
        <div style={{ padding: '24px' }}>
            <div className="fade-in" style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 300px', gap: '24px' }}>
                {/* Main List Area */}
                <div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '16px' }}>
                        <h2 style={{ fontSize: '18px', fontWeight: 600 }}>Product Categories</h2>
                        <div style={{ position: 'relative', width: isMobile ? '100%' : '300px' }}>
                            <Search size={18} style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
                            <input
                                type="text"
                                placeholder="Search categories..."
                                value={searchTerm}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                style={{ width: '100%', padding: '10px 16px 10px 40px', borderRadius: '10px', border: '1px solid var(--color-border)', fontSize: '14px', outline: 'none' }}
                            />
                        </div>
                    </div>

                    {filteredCategories.length === 0 ? (
                        <div style={{ padding: '60px 20px', textAlign: 'center', color: 'var(--color-text-secondary)', background: 'var(--color-surface)', borderRadius: '16px', border: '1px dashed var(--color-border)' }}>
                            <Tags size={48} style={{ opacity: 0.2, marginBottom: '16px', margin: '0 auto' }} />
                            <h3 style={{ fontSize: '16px', fontWeight: 600, color: 'var(--color-text-main)' }}>No categories found</h3>
                            <p style={{ fontSize: '14px', marginTop: '8px' }}>{searchTerm ? 'Try a different search term.' : 'Use the form to add your first category.'}</p>
                        </div>
                    ) : (
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '16px' }}>
                            {filteredCategories.map(category => {
                                const pCount = getProductCount(category);
                                return (
                                    <div key={category} className="glass-panel" style={{ padding: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                                            <div style={{ width: '36px', height: '36px', borderRadius: '10px', background: 'var(--color-primary-light)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--color-primary)' }}>
                                                <Tag size={18} />
                                            </div>
                                            <div>
                                                <h3 style={{ fontSize: '15px', fontWeight: 600 }}>{category}</h3>
                                                <div style={{ fontSize: '12px', color: 'var(--color-text-secondary)', marginTop: '2px' }}>
                                                    {pCount} {pCount === 1 ? 'product' : 'products'}
                                                </div>
                                            </div>
                                        </div>
                                        {isAdmin && (
                                            <button onClick={() => handleDeleteCategory(category)} className="icon-button" style={{ padding: '6px', color: '#EF4444' }}>
                                                <Trash2 size={16} />
                                            </button>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Sidebar Add Form */}
                {isAdmin && (
                    <div style={{ alignSelf: 'start' }}>
                        <div className="glass-panel" style={{ padding: '20px' }}>
                            <h3 style={{ fontSize: '16px', fontWeight: 600, marginBottom: '16px' }}>Add Category</h3>
                            <form onSubmit={handleAddCategory} style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                                <div>
                                    <label style={{ fontSize: '12px', fontWeight: 600, color: 'var(--color-text-secondary)', display: 'block', marginBottom: '6px' }}>Category Name *</label>
                                    <input
                                        required
                                        type="text"
                                        value={newCategory}
                                        onChange={e => setNewCategory(e.target.value)}
                                        placeholder="e.g., Portable Speakers"
                                        style={{ width: '100%', padding: '10px 12px', border: '1px solid var(--color-border)', borderRadius: '8px', fontSize: '13px', background: 'var(--color-bg)', outline: 'none' }}
                                    />
                                </div>
                                <button type="submit" className="primary-button" style={{ width: '100%', padding: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', marginTop: '4px' }}>
                                    <Plus size={16} /> Add Category
                                </button>
                            </form>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CategoriesPage;
