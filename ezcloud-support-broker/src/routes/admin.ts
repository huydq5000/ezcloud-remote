export const adminPage = `<!doctype html>
<meta charset="utf-8">
<title>ezCloud Remote</title>
<style>
  body { font-family: sans-serif; margin: 2rem; max-width: 52rem; }
  button { margin-right: .5rem; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border-bottom: 1px solid #ccc; text-align: left; padding: .4rem; }
</style>
<h1>Yêu cầu hỗ trợ</h1>
<p>Trang này chỉ gọi broker. Không gọi acl.ezcloud.vn.</p>
<label>Presence token <input id="token" size="60"></label>
<button id="load" type="button">Tải</button>
<p id="status"></p>
<table id="rows"></table>
<script>
const tokenBox = document.querySelector('#token')
tokenBox.value = sessionStorage.getItem('ez-presence') || ''
document.querySelector('#load').onclick = load
async function load() {
  sessionStorage.setItem('ez-presence', tokenBox.value)
  const headers = { authorization: 'Bearer ' + tokenBox.value }
  const me = await fetch('/admin/me', { headers })
  const meBody = await me.json()
  const canClose = !!(meBody.acl && (meBody.acl.permissions || []).some((item) => item.code === 'support.change'))
  document.querySelector('#status').textContent = me.ok ? ('Quyền: ' + (meBody.acl.permissions || []).map((item) => item.code).join(', ')) : 'Không vào được trang quản lý'
  const tickets = await fetch('/admin/tickets', { headers })
  const body = await tickets.json()
  const table = document.querySelector('#rows')
  table.innerHTML = ''
  for (const ticket of body.tickets || []) {
    const row = document.createElement('tr')
    const close = document.createElement('td')
    if (canClose && ticket.status !== 'closed') {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = 'Đóng'
      button.onclick = async () => {
        await fetch('/admin/tickets/' + ticket.ticket_id + '/close', { method: 'POST', headers })
        load()
      }
      close.append(button)
    }
    row.innerHTML = '<td></td><td></td><td></td>'
    row.children[0].textContent = ticket.name || ''
    row.children[1].textContent = ticket.device_id || ''
    row.children[2].textContent = ticket.status || ''
    row.append(close)
    table.append(row)
  }
}
</script>
`