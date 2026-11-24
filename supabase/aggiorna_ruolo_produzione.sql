-- Da eseguire UNA VOLTA, da sola, nei database creati prima del ruolo "produzione".
alter type public.ruolo_app add value if not exists 'produzione';
