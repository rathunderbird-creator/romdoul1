-- Run this in your Supabase SQL Editor to create the products bucket

-- Create the Storage Bucket for Product Images (making it public so URLs work directly)
INSERT INTO storage.buckets (id, name, public) VALUES ('products', 'products', true) ON CONFLICT (id) DO NOTHING;

-- Storage Policies for 'products' bucket

-- 1. Allow public read access (so anyone can view the images)
CREATE POLICY "Allow public read access for products bucket" 
ON storage.objects FOR SELECT 
TO public 
USING ( bucket_id = 'products' );

-- 2. Allow authenticated users to upload images
CREATE POLICY "Allow authenticated uploads to products bucket" 
ON storage.objects FOR INSERT 
TO authenticated 
WITH CHECK ( bucket_id = 'products' );

-- 3. Allow authenticated users to update their uploaded images
CREATE POLICY "Allow authenticated updates to products bucket" 
ON storage.objects FOR UPDATE 
TO authenticated 
USING ( bucket_id = 'products' );

-- 4. Allow authenticated users to delete images
CREATE POLICY "Allow authenticated deletes from products bucket" 
ON storage.objects FOR DELETE 
TO authenticated 
USING ( bucket_id = 'products' );
