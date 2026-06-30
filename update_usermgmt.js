const fs = require('fs');
let code = fs.readFileSync('frontend/src/views/UserManagement.jsx', 'utf8');

// 1. Add import
if (!code.includes('import InviteManagement')) {
  code = code.replace(
    'import { useAuth } from "../context/AuthContext";',
    'import { useAuth } from "../context/AuthContext";\nimport InviteManagement from "./InviteManagement";'
  );
}

// 2. Add activeTab state
if (!code.includes('activeTab')) {
  code = code.replace(
    'const [resetUser, setResetUser] = useState(null);',
    'const [resetUser, setResetUser] = useState(null);\n  const [activeTab, setActiveTab] = useState("users");'
  );
}

// 3. Add Tab UI & Conditionally render original content vs InviteManagement
const headerSection = `          </button>
        </div>
      </section>`;

const tabsUI = `          </button>
        </div>
      </section>

      {["SuperAdmin", "Admin"].includes(activeRole) && (
        <div className="flex gap-4 border-b border-slate-200 px-2 pb-1">
          <button
            onClick={() => setActiveTab("users")}
            className={\`pb-2 text-sm font-bold transition-all \${
              activeTab === "users"
                ? "border-b-2 border-blue-600 text-blue-700"
                : "text-slate-500 hover:text-slate-700"
            }\`}
          >
            System Users
          </button>
          <button
            onClick={() => setActiveTab("invites")}
            className={\`pb-2 text-sm font-bold transition-all \${
              activeTab === "invites"
                ? "border-b-2 border-blue-600 text-blue-700"
                : "text-slate-500 hover:text-slate-700"
            }\`}
          >
            Manage Invitations
          </button>
        </div>
      )}

      {activeTab === "users" ? (
        <>
`;

code = code.replace(headerSection, tabsUI);

// 4. Close the wrapper for activeTab === "users" right before the Modals
// Looking at the end of the return statement
const modalsSection = `      {formUser && (
        <UserModal`;
const closeTabs = `        </>
      ) : (
        <InviteManagement />
      )}

      {formUser && (
        <UserModal`;

code = code.replace(modalsSection, closeTabs);

fs.writeFileSync('frontend/src/views/UserManagement.jsx', code);
console.log('Successfully updated UserManagement.jsx');
