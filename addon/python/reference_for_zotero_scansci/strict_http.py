"""Strict HTTPS transport for enabled, audited source routes."""

import ipaddress
import json
import socket
from pathlib import Path
from urllib.parse import urljoin, urlparse


MAX_REDIRECTS = 5
MAX_JSON_BYTES = 2 * 1024 * 1024


class StrictHttpError(RuntimeError):
    pass


class StrictHttpClient:
    def __init__(self, route, timeout_seconds):
        import requests

        self._requests = requests
        self._route = route
        self._timeout_seconds = timeout_seconds
        self._allowed_hosts = {
            host.lower() for host in route.get("allowedHosts", [])
        }
        self._session = requests.Session()
        self._session.trust_env = False
        self.egress_hosts = []

    def get_json(self, url):
        response, final_url = self._request(url, stream=True)
        try:
            content = bytearray()
            for chunk in response.iter_content(chunk_size=64 * 1024):
                content.extend(chunk)
                if len(content) > MAX_JSON_BYTES:
                    raise StrictHttpError("Source metadata response exceeded its limit")
            return json.loads(bytes(content).decode("utf-8")), final_url
        finally:
            response.close()

    def download_to(self, url, output_path):
        response, final_url = self._request(url, stream=True)
        target = Path(output_path)
        created = False
        try:
            output = target.open("xb")
            created = True
            with output:
                for chunk in response.iter_content(chunk_size=64 * 1024):
                    if chunk:
                        output.write(chunk)
        except Exception:
            if created:
                target.unlink(missing_ok=True)
            raise
        finally:
            response.close()
        return final_url

    def _request(self, initial_url, stream):
        current = initial_url
        for redirect_count in range(MAX_REDIRECTS + 1):
            host = self._validate_egress(current)
            if host not in self.egress_hosts:
                self.egress_hosts.append(host)
            response = self._session.get(
                current,
                allow_redirects=False,
                stream=stream,
                timeout=self._timeout_seconds,
                verify=True,
                headers={"User-Agent": "reference-for-zotero-scansci/3"},
            )
            self._validate_peer(response, host)
            if response.status_code in (301, 302, 303, 307, 308):
                location = response.headers.get("Location")
                response.close()
                if not location or redirect_count == MAX_REDIRECTS:
                    raise StrictHttpError("Source returned an invalid redirect")
                current = urljoin(current, location)
                continue
            if response.status_code != 200:
                status = response.status_code
                response.close()
                raise StrictHttpError(f"Source returned HTTP {status}")
            return response, current
        raise StrictHttpError("Source exceeded the redirect limit")

    def _validate_egress(self, url):
        parsed = urlparse(url)
        host = (parsed.hostname or "").lower()
        if parsed.scheme != "https" or not host or parsed.port not in (None, 443):
            raise StrictHttpError("Source egress must use standard-port HTTPS")
        if host not in self._allowed_hosts:
            raise StrictHttpError(f"Source egress host is not allowed: {host}")
        addresses = socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)
        if not addresses:
            raise StrictHttpError(f"Source egress host did not resolve: {host}")
        for address in addresses:
            ip = ipaddress.ip_address(address[4][0])
            if not ip.is_global:
                raise StrictHttpError(
                    f"Source egress resolved to a non-public address: {host}"
                )
        return host

    def _validate_peer(self, response, host):
        connection = getattr(response.raw, "_connection", None)
        socket_connection = getattr(connection, "sock", None)
        if socket_connection is None:
            if response.status_code in (301, 302, 303, 307, 308):
                # urllib3 may release a zero-body redirect connection before the
                # response object is returned. The hop still passed the DNS,
                # HTTPS hostname, certificate, port, and host allowlist checks.
                return
            response.close()
            raise StrictHttpError(f"Source peer address is unavailable: {host}")
        peer = ipaddress.ip_address(socket_connection.getpeername()[0])
        if not peer.is_global:
            response.close()
            raise StrictHttpError(
                f"Source connected to a non-public peer address: {host}"
            )
