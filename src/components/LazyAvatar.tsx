import React, { useRef, useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { useIntersectionObserver } from '../hooks/useIntersectionObserver';

interface LazyAvatarProps {
    productId: string;
    initialImage?: string;
    alt: string;
    className?: string;
    style?: React.CSSProperties;
}

const LazyAvatar: React.FC<LazyAvatarProps> = ({ productId, initialImage, alt, className, style }) => {
    const imageContainerRef = useRef<HTMLDivElement>(null);
    const hasIntersected = useIntersectionObserver(imageContainerRef, {
        rootMargin: '100px', // start loading right before it enters screen
        threshold: 0.1
    });

    const [lazyImage, setLazyImage] = useState<string>(initialImage || '');

    useEffect(() => {
        if (hasIntersected && !lazyImage && productId) {
            let isMounted = true;
            const fetchImage = async () => {
                try {
                    const { data } = await supabase.from('products').select('image').eq('id', productId).single();
                    if (isMounted && data?.image) {
                        setLazyImage(data.image);
                    }
                } catch (e) {
                    console.error('Lazy image load failed', e);
                }
            };
            fetchImage();
            return () => { isMounted = false; };
        }
    }, [hasIntersected, lazyImage, productId]);

    return (
        <div ref={imageContainerRef} className={className} style={{ ...style, position: 'relative', overflow: 'hidden' }}>
            {lazyImage ? (
                <img
                    src={lazyImage}
                    alt={alt}
                    style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
            ) : (
                <div style={{ width: '100%', height: '100%', background: 'var(--color-bg)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ width: '40%', height: '40%', borderRadius: '50%', background: 'var(--color-border)', opacity: 0.5, animation: 'pulse 1.5s infinite' }} />
                </div>
            )}
        </div>
    );
};

export default LazyAvatar;
