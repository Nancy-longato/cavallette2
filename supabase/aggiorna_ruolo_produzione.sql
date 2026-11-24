-- Da eseguire UNA VOLTA, da sola, nei database creati prima dei ruoli "produzione" e "autista".
alter type public.ruolo_app add value if not exists 'produzione';
alter type public.ruolo_app add value if not exists 'autista';
