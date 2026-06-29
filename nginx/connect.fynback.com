server {
    server_name connectapp.theiconicdental.com;
    client_max_body_size 2048M;

    location / {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Increase buffer limits to prevent "upstream sent too big header" errors
        proxy_buffer_size          128k;
        proxy_buffers              4 256k;
        proxy_busy_buffers_size    256k;
    }

    location /api/cases/upload {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;

        # Disable request body buffering to allow direct streaming
        proxy_request_buffering off;
        proxy_buffering off;

        # Timeouts for large uploads
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
    }


    listen 443 ssl; # managed by Certbot
    ssl_certificate /etc/letsencrypt/live/connectapp.theiconicdental.com/fullchain.pem; # managed by Certbot
    ssl_certificate_key /etc/letsencrypt/live/connectapp.theiconicdental.com/privkey.pem; # managed by Certbot
    include /etc/letsencrypt/options-ssl-nginx.conf; # managed by Certbot
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem; # managed by Certbot

}
server {
    if ($host = connectapp.theiconicdental.com) {
        return 301 https://$host$request_uri;
    } # managed by Certbot


    listen 80;
    server_name connectapp.theiconicdental.com;
    return 404; # managed by Certbot


}