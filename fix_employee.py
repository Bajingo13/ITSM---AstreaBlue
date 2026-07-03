import sys

file_path = 'frontend/src/views/EmployeeDashboard.jsx'
with open(file_path, 'r') as f:
    content = f.read()

# Fix requester_id in payload
old_payload = 'body: JSON.stringify(buildTicketPayload(user, { ...form, category_id: categoryId })),'
new_payload = 'body: JSON.stringify(buildTicketPayload(user, { ...form, category_id: categoryId, requester_id: user?.user_id })),'
content = content.replace(old_payload, new_payload)

# Append uploadTicketAttachments if not already there
upload_func = '''
async function uploadTicketAttachments(ticketId, files, uploadedBy) {
  if (!ticketId || !files.length) return;

  const formData = new FormData();
  files.forEach((file) => formData.append("attachments", file));
  if (uploadedBy) formData.append("uploaded_by", uploadedBy);

  const res = await fetch(\/tickets/\/attachments, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const data = await res.json().catch(()=>({}));
    throw new Error(data.error || "Failed to upload attachments");
  }
}
'''
if 'uploadTicketAttachments(' not in content:
    content += upload_func

with open(file_path, 'w') as f:
    f.write(content)
